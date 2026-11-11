import {
  computeLedger,
  computePortfolioHistory,
  type DailyHistory,
  type PortfolioHistory,
  type PricePoint,
  type CarteraView,
  type Instrument,
  type Operation,
  type Quote,
} from '@watchlist/shared';
import { MINOR_UNITS, type MarketService } from '../market/market.service.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';
import type { InstrumentsRepository, OperationsRepository } from './cartera.repository.ts';

/** Fichas pedidas a Yahoo en cada carga como mucho (el resto, en las siguientes). */
const PROFILES_PER_VIEW = 8;

export class LedgerError extends Error {
  statusCode = 400;
}

/**
 * Cartera real: el registro de operaciones y los precios de hoy. Los cálculos (FIFO, plusvalías, Renta)
 * los hace el cliente con el mismo motor de @watchlist/shared; el servidor solo valida que el registro
 * siga cuadrando antes de guardar.
 */
export class PortfolioService {
  private profilesRunning = false;

  constructor(
    private operations: OperationsRepository,
    private instruments: InstrumentsRepository,
    private settings: SettingsRepository,
    private market: MarketService,
  ) {}

  async history(from: string, to: string): Promise<PortfolioHistory> {
    const [operations, instruments] = await Promise.all([this.operations.all(), this.instruments.all()]);
    const held = computeLedger(operations.filter((o) => o.date < from)).tickers.filter((t) => t.shares > 1e-6);
    const relevant = new Set(held.map((t) => t.ticker));
    for (const op of operations) {
      if (op.date >= from && op.date <= to && (op.type === 'buy' || op.type === 'scrip')) relevant.add(op.ticker);
    }
    const selected = instruments.filter((i) => relevant.has(i.ticker));
    const prices: Record<string, DailyHistory> = {};
    const fx: Record<string, PricePoint[]> = {};
    let stale = false;
    const symbols = [...new Set(selected.flatMap((i) => i.symbol ? [i.symbol] : []))];
    // Dos peticiones como máximo a la vez: una cartera importada puede tener cientos de valores.
    for (let i = 0; i < symbols.length; i += 2) {
      await Promise.all(symbols.slice(i, i + 2).map(async (symbol) => {
        const history = await this.market.getDailyHistory(symbol, from);
        prices[symbol] = history;
        stale ||= history.stale;
      }));
    }
    const currencies = [...new Set(selected.map((i) => (i.symbol ? prices[i.symbol]?.currency : null) ?? i.currency))];
    for (const currency of currencies) {
      if (currency === 'EUR') continue;
      const { major, factor } = MINOR_UNITS[currency] ?? { major: currency, factor: 1 };
      const history = await this.market.getDailyHistory(`EUR${major}=X`, from);
      fx[currency] = history.points.map((p) => ({ ...p, c: p.c * factor }));
      stale ||= history.stale;
    }
    const points = computePortfolioHistory({ operations, instruments, prices, fx, from, to });
    return { from, to, points, stale, missing: [...new Set(points.flatMap((p) => p.missing))] };
  }

  async view({ force = false } = {}): Promise<CarteraView> {
    const [operations, instruments, settings] = await Promise.all([
      this.operations.all(),
      this.instruments.all(),
      this.settings.get(),
    ]);
    // Precio solo de lo que sigue en cartera (lo cerrado no lo necesita).
    const ledger = computeLedger(operations);
    const open = new Set(ledger.tickers.filter((t) => t.shares > 1e-9).map((t) => t.ticker));
    const symbols = instruments.filter((i) => i.symbol && open.has(i.ticker)).map((i) => i.symbol!);
    const quotes = await this.market.getQuotes(symbols, { force });
    const fx = await this.market.getFxRates(settings.baseCurrency, [
      ...[...quotes.values()].map((q) => q.currency),
      ...instruments.filter((i) => open.has(i.ticker)).map((i) => i.currency),
    ]);
    void this.fillProfiles([...instruments.filter((i) => open.has(i.ticker)), ...instruments.filter((i) => !open.has(i.ticker))]);
    const bySymbol: Record<string, Quote> = {};
    for (const [sym, q] of quotes) bySymbol[sym] = q;
    return {
      instruments,
      operations,
      quotes: bySymbol,
      fx,
      generatedAt: new Date().toISOString(),
      throttledUntil: this.market.throttledUntilIso,
    };
  }

  /** Lanza un error 400 si el registro no cuadra (se vende más de lo que hay…). */
  static assertValid(operations: Operation[]) {
    const { issues } = computeLedger(operations);
    if (issues.length) throw new LedgerError(issues.map((i) => i.message).join(' '));
  }

  /** Sector y nombre desde Yahoo para los valores que no los tienen (en segundo plano, poco a poco). */
  private async fillProfiles(instruments: Instrument[]) {
    if (this.profilesRunning) return;
    const pending = instruments.filter((i) => i.symbol && (!i.sector || !i.name)).slice(0, PROFILES_PER_VIEW);
    if (!pending.length) return;
    this.profilesRunning = true;
    try {
      for (const i of pending) {
        const p = await this.market.getProfile(i.symbol!);
        if (p) await this.instruments.fillProfile(i.ticker, p);
      }
    } catch {
      // Sin ficha no pasa nada: se intentará en otra carga.
    } finally {
      this.profilesRunning = false;
    }
  }
}
