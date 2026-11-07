import type { AnalystTargets, Quote, SymbolSearchResult } from '@watchlist/shared';

/**
 * Contrato de cualquier fuente de datos de mercado.
 * Para añadir otra (FMP, EODHD, Alpha Vantage…) implementa esta interfaz
 * y regístrala en app.ts.
 */
export interface MarketDataProvider {
  readonly id: string;
  /** Devuelve las cotizaciones encontradas; los símbolos desconocidos se omiten. */
  getQuotes(symbols: string[]): Promise<Omit<Quote, 'stale'>[]>;
  /** Consenso de analistas. `null` si el valor no tiene cobertura (p. ej. ETF). */
  getTargets(symbol: string): Promise<Omit<AnalystTargets, 'fetchedAt'> | null>;
  search(query: string): Promise<SymbolSearchResult[]>;
}
