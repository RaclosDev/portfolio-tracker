import type { Instrument, Operation } from './cartera/schemas.ts';
import type { ItemData, Settings } from './schemas.ts';

export interface WatchList {
  id: number;
  name: string;
  itemCount: number;
}

export interface Item extends ItemData {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  symbol: string;
  name: string | null;
  currency: string | null;
  price: number | null;
  changePct: number | null;
  previousClose: number | null;
  low52: number | null;
  high52: number | null;
  quoteType: string | null;
  exchange: string | null;
  marketState: string | null;
  fetchedAt: string;
  /** true si la fuente falló y se muestra el último dato guardado. */
  stale: boolean;
}

export interface AnalystTargets {
  mean: number | null;
  median: number | null;
  high: number | null;
  low: number | null;
  analysts: number | null;
  recommendation: string | null;
  recommendationMean: number | null;
  /** Datos fundamentales y fechas clave (se piden junto al consenso, caché de 12 h). */
  nextEarnings?: string | null;
  exDividend?: string | null;
  /** Rentabilidad por dividendo (fracción: 0,028 = 2,8 %). */
  dividendYield?: number | null;
  trailingPE?: number | null;
  marketCap?: number | null;
  fetchedAt: string;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

export type LevelStatus = 'reached' | 'veryNear' | 'near' | 'far' | 'veryFar' | 'unknown';

export interface LevelView {
  price: number;
  /** (nivel - actual) / actual. Negativo = el precio tiene que caer. */
  distancePct: number | null;
  status: LevelStatus;
}

export interface RowMetrics {
  levels: LevelView[];
  status: LevelStatus;
  /** Distancia del nivel pendiente más cercano (0 si alguno ya se alcanzó). */
  nearestDistancePct: number | null;
  /** Unidades de la divisa del valor por 1 de divisa base. */
  fxRate: number | null;
  investAmount: number;
  sharesCalc: number | null;
  shares: number | null;
  /** Precio de entrada usado en los cálculos (orden activa o compra 1). */
  entryPrice: number | null;
  netNative: number | null;
  netBase: number | null;
  diffBase: number | null;
  upsideBrokerPct: number | null;
  upsideConsensusPct: number | null;
  orderDaysLeft: number | null;
  orderExpired: boolean;
}

export interface WatchlistRow {
  item: Item;
  quote: Quote | null;
  targets: AnalystTargets | null;
  metrics: RowMetrics;
}

export interface WatchlistView {
  list: WatchList;
  settings: Settings;
  rows: WatchlistRow[];
  fx: Record<string, number>;
  generatedAt: string;
  /** Si el proveedor de cotizaciones nos limita, hasta cuándo se pausan las consultas (ISO). */
  throttledUntil?: string | null;
}

/** Periodos del gráfico histórico. */
export type HistoryRange = '1m' | '3m' | '6m' | '1y' | '5y';
export const HISTORY_RANGES: { id: HistoryRange; label: string }[] = [
  { id: '1m', label: '1 mes' },
  { id: '3m', label: '3 meses' },
  { id: '6m', label: '6 meses' },
  { id: '1y', label: '1 año' },
  { id: '5y', label: '5 años' },
];

/** Cierre de un día (o semana, en 5 años). */
export interface PricePoint {
  t: string;
  c: number;
}

/** Lo que devuelve GET /api/portfolio: el registro y los precios; los cálculos se hacen en el cliente. */
export interface CarteraView {
  instruments: Instrument[];
  operations: Operation[];
  /** Cotizaciones por símbolo de Yahoo. */
  quotes: Record<string, Quote>;
  /** Unidades de cada divisa por 1 €. */
  fx: Record<string, number>;
  generatedAt: string;
  throttledUntil?: string | null;
}
