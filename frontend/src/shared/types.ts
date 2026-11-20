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
  /** Fuente y fecha real del precio, independientes de la hora de consulta. */
  source?: string;
  sourceUrl?: string;
  asOf?: string;
  /** Momento del último precio en la bolsa (ISO). Si es de una sesión anterior, el precio no es de hoy. */
  priceTime?: string;
  isin?: string;
  /** true si la fuente falló y se muestra el último dato guardado. */
  stale: boolean;
  /** true si la consulta principal de la fuente falló y el precio llega por su vía alternativa. */
  fallback?: boolean;
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
  /** Si se conoce (al elegir el producto por su ISIN). */
  isin?: string | null;
}

/**
 * «Visitados»: valores abiertos desde el buscador de la cabecera. Se ven como una lista más, pero no es
 * una lista guardada (no cuenta para alertas, cartera ni copias): id fijo y negativo.
 */
export const VISITED_LIST_ID = -1;
export const VISITED_LIST_NAME = 'Visitados';
export interface VisitedSymbol extends SymbolSearchResult {
  visitedAt: string;
}

/** Un producto (acción, ETF, fondo…) identificado por su ISIN, sin elegir aún la bolsa. */
export interface InstrumentHit {
  isin: string;
  name: string;
  type: string | null;
}

/** Una bolsa o plataforma donde se puede seguir un producto, con su último precio si lo hay. */
export interface Listing extends SymbolSearchResult {
  currency: string | null;
  price: number | null;
  /** Solo hay precio actual: sin gráfico ni histórico. */
  priceOnly: boolean;
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

/** Orden activa a cuyo precio ha llegado la cotización: queda pendiente hasta que se apunta la compra o se descarta. */
export interface TouchedOrder {
  itemId: number;
  listId: number;
  symbol: string;
  ticker: string | null;
  isin: string | null;
  name: string | null;
  currency: string;
  orderPrice: number;
  /** Cotización cuando se vio que la tocaba. */
  price: number;
  /** Acciones previstas para la compra (las fijadas a mano o las calculadas con el importe). */
  shares: number | null;
  broker: string | null;
  /** Momento en que se detectó (ISO). */
  at: string;
  /** Descartada a mano: no se enseña, pero no se vuelve a apuntar mientras la orden siga igual. */
  dismissed?: boolean;
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
  /** Divisas cuyo cambio es un dato guardado (la fuente falló). */
  fxStale?: string[];
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

/** Observación de precio fechada; la frecuencia depende de la fuente y el periodo. */
export interface PricePoint {
  t: string;
  c: number;
}

/** Vela diaria (fecha AAAA-MM-DD). La de hoy, mientras dura la sesión, va con el último precio como cierre. */
export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Herramientas de dibujo del gráfico de velas (las mismas que en Financial Hub). */
export type ChartDrawingType =
  | 'hline' | 'hray' | 'vline' | 'text'
  | 'trend' | 'ray' | 'extended' | 'fib' | 'rect' | 'arrow'
  | 'channel' | 'long' | 'short';
/**
 * Dibujo del gráfico de velas: los puntos son fecha de sesión y precio. El canal usa los dos primeros como
 * línea base y el tercero como distancia de la paralela; las posiciones largas y cortas, [entrada, objetivo,
 * stop] (la fecha del objetivo marca hasta dónde llega la caja).
 */
export interface ChartDrawing {
  id: string;
  type: ChartDrawingType;
  points: ChartPoint[];
  color?: string;
  /** Grosor en píxeles (1-4). */
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  locked?: boolean;
  text?: string;
}
export interface ChartPoint {
  t: string;
  p: number;
}

/** Lo que devuelve GET /api/portfolio: el registro y los precios; los cálculos se hacen en el cliente. */
export interface CarteraView {
  instruments: Instrument[];
  operations: Operation[];
  /** Cotizaciones por símbolo o identificador de la fuente. */
  quotes: Record<string, Quote>;
  /** Unidades de cada divisa por 1 €. */
  fx: Record<string, number>;
  /** Divisas cuyo cambio es un dato guardado (la fuente falló): su valoración no está al día. */
  fxStale?: string[];
  generatedAt: string;
  throttledUntil?: string | null;
}

/** Lo que cambia de {@link CarteraView} entre dos refrescos en directo. */
export type PortfolioQuotes = Pick<CarteraView, 'quotes' | 'fx' | 'fxStale' | 'generatedAt' | 'throttledUntil'>;
