import type { AnalystTargets, Candle, IntradayInterval, DailyHistory, HistoryRange, InstrumentHit, PricePoint, Quote, SymbolSearchResult } from '@watchlist/shared';

/** Catálogo de productos por nombre, ISIN o WKN (sin precios). */
export interface InstrumentCatalog {
  findInstruments(query: string): Promise<InstrumentHit[]>;
}

/** Varios catálogos como uno: se consultan a la vez y el que falla no tapa a los demás. */
export function mergeCatalogs(catalogs: InstrumentCatalog[], log: (message: string, error?: unknown) => void = () => {}): InstrumentCatalog {
  return {
    async findInstruments(query) {
      const lists = await Promise.all(catalogs.map((c) => c.findInstruments(query).catch((err) => (log(`No se pudo buscar el producto «${query}»`, err), []))));
      // Intercalados: el primer acierto de cada catálogo queda arriba, no detrás de todos los del anterior.
      return Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.flatMap((l) => l.slice(i, i + 1))).flat();
    },
  };
}

/**
 * Contrato de cualquier fuente de datos de mercado.
 * Para añadir otra (FMP, EODHD, Alpha Vantage…) implementa esta interfaz
 * y regístrala en services.ts.
 */
export interface MarketDataProvider {
  readonly id: string;
  /** Devuelve las cotizaciones encontradas; los símbolos desconocidos se omiten. */
  getQuotes(symbols: string[]): Promise<Omit<Quote, 'stale'>[]>;
  /** Consenso de analistas. `null` si el valor no tiene cobertura (p. ej. ETF). */
  getTargets(symbol: string): Promise<Omit<AnalystTargets, 'fetchedAt'> | null>;
  search(query: string): Promise<SymbolSearchResult[]>;
  /** Cierres históricos del periodo, del más antiguo al más reciente. */
  getHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]>;
  /** Cierres diarios desde una fecha hasta hoy, sin ajuste retrospectivo por splits. */
  getDailyHistory?(symbol: string, from: string): Promise<DailyHistory>;
  /** Velas diarias desde una fecha, con la de hoy si hay sesión abierta. */
  getCandles?(symbol: string, from: string): Promise<Candle[]>;
  /** Velas intradía recientes del intervalo, con la fecha y hora UTC de su inicio. */
  getIntradayCandles?(symbol: string, interval: IntradayInterval): Promise<Candle[]>;
  /** Ficha de la empresa (sector en español). Opcional: sin ella la cartera queda «Sin sector». */
  getProfile?(symbol: string): Promise<CompanyProfile | null>;
  /** Estado de la fuente para /api/health: último fallo y pausas. Sin datos de usuarios. */
  diagnostics?(): Record<string, unknown>;
}

/** Texto corto de un error para el diagnóstico público: sin la consulta de las URL (lleva los símbolos pedidos). */
export const errorSummary = (error: unknown) =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).replace(/\?[^\s"')]*/g, '').slice(0, 200);

export interface CompanyProfile {
  name: string | null;
  sector: string | null;
}
