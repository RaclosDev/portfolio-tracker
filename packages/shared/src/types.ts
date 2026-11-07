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
  fetchedAt: string;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

export type LevelStatus = 'reached' | 'near' | 'far' | 'veryFar' | 'unknown';

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
}
