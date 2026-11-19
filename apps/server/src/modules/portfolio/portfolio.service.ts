import {
  computeLedger,
  computePortfolioHistory,
  isFundType,
  shiftDate,
  type FundComposition,
  type DailyHistory,
  type PortfolioHistory,
  type PricePoint,
  type CarteraView,
  type Instrument,
  type Operation,
  type Quote,
} from '@watchlist/shared';
import { MINOR_UNITS, type MarketService } from '../market/market.service.ts';
import { isinInSymbol } from '../market/composition.ts';
import type { InstrumentsRepository, OperationsRepository } from './cartera.repository.ts';

/** Fichas pedidas a Yahoo en cada carga como mucho (el resto, en las siguientes). */
const PROFILES_PER_VIEW = 8;
/** Un valor sin sector o nombre en Yahoo se vuelve a pedir como pronto al día siguiente. */
const PROFILE_RETRY_MS = 24 * 3_600_000;

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
  /** Cuándo se pidió la ficha de cada valor: los que Yahoo no completa no bloquean a los siguientes. */
  private profileTried = new Map<string, number>();

  constructor(
    private operations: OperationsRepository,
    private instruments: InstrumentsRepository,
    private market: MarketService,
  ) {}

  async history(from: string, to: string): Promise<PortfolioHistory> {
    const [operations, instruments] = await Promise.all([this.operations.all(), this.instruments.all()]);
    const held = computeLedger(operations.filter((o) => o.date < from)).tickers.filter((t) => t.shares > 1e-6);
    const relevant = new Set(held.map((t) => t.ticker));
    for (const op of operations) {
      if (op.date >= from && op.date <= to && (op.type === 'buy' || op.type === 'scrip' || op.type === 'transfer_in')) relevant.add(op.ticker);
    }
    const selected = instruments.filter((i) => relevant.has(i.ticker));
    const prices: Record<string, DailyHistory> = {};
    const fx: Record<string, PricePoint[]> = {};
    let stale = false;
    const symbols = [...new Set(selected.flatMap((i) => i.symbol ? [i.symbol] : []))];
    // Dos peticiones como máximo a la vez: una cartera importada puede tener cientos de valores.
    for (let i = 0; i < symbols.length; i += 2) {
      await Promise.all(symbols.slice(i, i + 2).map(async (symbol) => {
        const history = await this.market.getDailyHistory(symbol, shiftDate(from, -1));
        prices[symbol] = history;
        stale ||= history.stale;
      }));
    }
    const currencies = [...new Set(selected.map((i) => (i.symbol ? prices[i.symbol]?.currency : null) ?? i.currency))];
    for (const currency of currencies) {
      if (currency === 'EUR') continue;
      const { major, factor } = MINOR_UNITS[currency] ?? { major: currency, factor: 1 };
      const history = await this.market.getDailyHistory(`EUR${major}=X`, shiftDate(from, -1));
      fx[currency] = history.points.map((p) => ({ ...p, c: p.c * factor }));
      stale ||= history.stale;
    }
    const points = computePortfolioHistory({ operations, instruments, prices, fx, from, to });
    const hasPrices = (series: PricePoint[] = []) => series.some(p =>
      Number.isFinite(p.c) && p.c > 0 && p.t.slice(0, 10) >= shiftDate(from, -8) && p.t.slice(0, 10) <= to);
    const excluded = selected.filter(instrument => {
      const history = instrument.symbol ? prices[instrument.symbol] : undefined;
      const currency = history?.currency ?? instrument.currency;
      return !hasPrices(history?.points) || (currency !== 'EUR' && !hasPrices(fx[currency]));
    });
    const excludedTickers = new Set(excluded.map(i => i.ticker));
    // Un histórico parcial debe excluir toda la cadena de fondos enlazados por traspasos.
    let changed = true;
    while (changed) {
      changed = false;
      const refs = new Set(operations.filter(o => excludedTickers.has(o.ticker) && o.transferRef).map(o => o.transferRef));
      for (const o of operations) if (o.transferRef && refs.has(o.transferRef) && !excludedTickers.has(o.ticker)) {
        excludedTickers.add(o.ticker);
        changed = true;
      }
    }
    const excludedLinked = selected.filter(i => excludedTickers.has(i.ticker));
    const available = excludedLinked.length > 0 && excludedLinked.length < selected.length ? {
      points: computePortfolioHistory({
        operations: operations.filter(o => !excludedTickers.has(o.ticker)),
        instruments: instruments.filter(i => !excludedTickers.has(i.ticker)), prices, fx, from, to,
      }),
      included: selected.length - excludedLinked.length,
      excluded: excludedLinked.map(i => ({ ticker: i.ticker, name: i.name || i.ticker })),
    } : undefined;
    return { from, to, points, stale, missing: [...new Set(points.flatMap((p) => p.missing))], available };
  }

  async view({ force = false } = {}): Promise<CarteraView> {
    const [operations, instruments] = await Promise.all([this.operations.all(), this.instruments.all()]);
    // Precio solo de lo que sigue en cartera (lo cerrado no lo necesita).
    const ledger = computeLedger(operations);
    const open = new Set(ledger.tickers.filter((t) => t.shares > 1e-9).map((t) => t.ticker));
    const symbols = instruments.filter((i) => i.symbol && open.has(i.ticker)).map((i) => i.symbol!);
    const quotes = await this.market.getQuotes(symbols, { force });
    // La cartera va siempre en euros (costes, Renta): no depende de la divisa base de la lista.
    const fxStale = new Set<string>();
    const fx = await this.market.getFxRates('EUR', [
      ...[...quotes.values()].map((q) => q.currency),
      ...instruments.filter((i) => open.has(i.ticker)).map((i) => i.currency),
    ], undefined, fxStale);
    void this.fillProfiles([...instruments.filter((i) => open.has(i.ticker)), ...instruments.filter((i) => !open.has(i.ticker))]);
    const bySymbol: Record<string, Quote> = {};
    for (const [sym, q] of quotes) bySymbol[sym] = q;
    return {
      instruments,
      operations,
      quotes: bySymbol,
      fx,
      fxStale: [...fxStale],
      generatedAt: new Date().toISOString(),
      throttledUntil: this.market.throttledUntilIso,
    };
  }

  /**
   * Mayores posiciones de cada fondo o ETF que sigue en cartera, por ticker (null si ninguna fuente lo conoce).
   * Las acciones no aparecen: solo lo que es un fondo o podría serlo (sin tipo conocido pero con ISIN).
   */
  async composition(): Promise<Record<string, FundComposition | null>> {
    const [operations, instruments] = await Promise.all([this.operations.all(), this.instruments.all()]);
    const open = new Set(computeLedger(operations).tickers.filter((t) => t.shares > 1e-9).map((t) => t.ticker));
    const held = instruments.filter((i) => open.has(i.ticker));
    const quotes = await this.market.getQuotes(held.flatMap((i) => (i.symbol ? [i.symbol] : [])));
    const funds = held.flatMap((i) => {
      const quote = i.symbol ? quotes.get(i.symbol) : undefined;
      const isin = i.isin ?? quote?.isin ?? isinInSymbol(i.symbol);
      const candidate = quote?.quoteType ? isFundType(quote.quoteType) : !!isin;
      return candidate ? [{ ticker: i.ticker, ref: { isin: isin?.toUpperCase() ?? null, symbol: i.symbol ?? null } }] : [];
    });
    const out: Record<string, FundComposition | null> = {};
    // De tres en tres: la primera vez cada fondo puede recorrer varias fuentes.
    for (let i = 0; i < funds.length; i += 3) {
      await Promise.all(funds.slice(i, i + 3).map(async (f) => {
        out[f.ticker] = await this.market.getComposition(f.ref);
      }));
    }
    return out;
  }

  /** Lanza un error 400 si el registro no cuadra (se vende más de lo que hay…). */
  static assertValid(operations: Operation[]) {
    const { issues } = computeLedger(operations);
    if (issues.length) throw new LedgerError(issues.map((i) => i.message).join(' '));
  }

  /** Sector y nombre desde Yahoo para los valores que no los tienen (en segundo plano, poco a poco). */
  private async fillProfiles(instruments: Instrument[]) {
    if (this.profilesRunning) return;
    const now = Date.now();
    const pending = instruments
      .filter((i) => i.symbol && (!i.sector || !i.name) && now - (this.profileTried.get(i.ticker) ?? 0) > PROFILE_RETRY_MS)
      .slice(0, PROFILES_PER_VIEW);
    if (!pending.length) return;
    this.profilesRunning = true;
    try {
      for (const i of pending) {
        if (this.profileTried.size >= 5000) this.profileTried.clear();
        this.profileTried.set(i.ticker, now);
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
