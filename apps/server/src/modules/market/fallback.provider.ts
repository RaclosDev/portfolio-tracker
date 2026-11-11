import type { AnalystTargets, DailyHistory, HistoryRange, PricePoint, Quote, SymbolSearchResult } from '@watchlist/shared';
import type { CompanyProfile, MarketDataProvider } from './provider.ts';
import { isIsin } from './isin.ts';

/** Las pausas pertenecen a cada fuente: un 429 de Yahoo no bloquea las alternativas. */
export class FallbackProvider implements MarketDataProvider {
  readonly id: string;
  private pauses = new Map<string, { until: number; backoff: number }>();
  constructor(private providers: MarketDataProvider[], private log: (message: string, error?: unknown) => void = () => {}) {
    this.id = providers.map(p => p.id).join('+');
  }

  private async call<T>(provider: MarketDataProvider, run: () => Promise<T>): Promise<T | undefined> {
    const pause = this.pauses.get(provider.id);
    if (pause && pause.until > Date.now()) return undefined;
    try {
      const result = await run();
      if (this.pauses.get(provider.id) === pause) this.pauses.delete(provider.id);
      return result;
    } catch (error) {
      const rateLimited = /\b429\b|too many requests/i.test(String(error));
      const backoff = rateLimited ? Math.min((pause?.backoff ?? 30_000) * 2, 15 * 60_000) : 60_000;
      // Un símbolo inexistente no debe pausar los demás valores del proveedor.
      if (rateLimited || /\b5\d\d\b|timeout|timed out|fetch failed|ECONN/i.test(String(error))) {
        this.pauses.set(provider.id, { until: Date.now() + backoff, backoff });
      }
      this.log(`No responde ${provider.id}; se prueban las demás fuentes`, error);
      return undefined;
    }
  }

  async getQuotes(symbols: string[]): Promise<Omit<Quote, 'stale'>[]> {
    const missing = new Set(symbols.map(symbol => symbol.toUpperCase()));
    const results: Omit<Quote, 'stale'>[] = [];
    for (const provider of this.providers) {
      if (!missing.size) break;
      // Yahoo cotiza con sus tickers; los ISIN se resuelven a esos tickers en la búsqueda.
      const requested = [...missing].filter(symbol => provider.id !== 'yahoo' || (!symbol.startsWith('BORSA:') && !isIsin(symbol)));
      if (!requested.length) continue;
      const quotes = await this.call(provider, () => provider.getQuotes(requested));
      for (const quote of quotes ?? []) {
        const symbol = quote.symbol.toUpperCase();
        if (!missing.has(symbol) || quote.price == null || !Number.isFinite(quote.price) || quote.price <= 0 || !quote.currency) continue;
        results.push({ ...quote, symbol });
        missing.delete(symbol);
      }
    }
    return results;
  }

  private async first<T>(symbol: string, run: (provider: MarketDataProvider) => Promise<T | null | undefined>, valid: (result: T) => boolean): Promise<T | null> {
    let failed = false;
    for (const provider of this.providers) {
      if (provider.id === 'yahoo' && (symbol.startsWith('BORSA:') || isIsin(symbol))) continue;
      const result = await this.call(provider, () => run(provider));
      if (result === undefined) failed = true;
      if (result != null && valid(result)) return result;
    }
    if (failed) throw new Error('Las fuentes disponibles no han podido completar la consulta');
    return null;
  }

  async getTargets(symbol: string): Promise<Omit<AnalystTargets, 'fetchedAt'> | null> {
    return this.first(symbol, p => p.getTargets(symbol), () => true);
  }
  async getProfile(symbol: string): Promise<CompanyProfile | null> {
    return this.first(symbol, p => p.getProfile?.(symbol) ?? Promise.resolve(null), () => true);
  }
  async getHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
    return await this.first(symbol, p => p.getHistory(symbol, range), points => points.length > 0) ?? [];
  }
  async getDailyHistory(symbol: string, from: string): Promise<DailyHistory> {
    return await this.first(symbol, p => p.getDailyHistory?.(symbol, from) ?? Promise.resolve(null), data => data.points.length > 0) ?? { currency: null, points: [] };
  }
  async search(query: string): Promise<SymbolSearchResult[]> {
    const results = new Map<string, SymbolSearchResult>();
    for (const provider of this.providers) {
      if (provider.id === 'yahoo' && query.toUpperCase().startsWith('BORSA:')) continue;
      for (const result of await this.call(provider, () => provider.search(query)) ?? []) {
        if (!results.has(result.symbol)) results.set(result.symbol, result);
      }
    }
    return [...results.values()];
  }
}
