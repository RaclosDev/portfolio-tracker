import type { Bands, Settings } from './schemas.ts';
import type {
  AnalystTargets,
  Item,
  LevelStatus,
  LevelView,
  PortfolioRow,
  PortfolioTotals,
  Position,
  PositionMetrics,
  Quote,
  RowMetrics,
  SellStatus,
} from './types.ts';

const pct = (to: number, from: number) => (to - from) / from;

/**
 * Estado de un nivel de compra respecto al precio actual:
 * en zona (precio ≤ nivel) · muy cerca (≤ veryNear %) · cerca (≤ near %) · lejos (≤ far %) · muy lejos.
 */
export function levelStatus(level: number, price: number | null, bands: Bands): LevelStatus {
  if (price == null || price <= 0) return 'unknown';
  if (price <= level) return 'reached';
  const dist = -pct(level, price) * 100; // % que tiene que caer
  const near = Math.max(bands.near, bands.veryNear);
  if (dist <= bands.veryNear) return 'veryNear';
  if (dist <= near) return 'near';
  return dist <= Math.max(bands.far, near) ? 'far' : 'veryFar';
}

/** Mayor = más urgente. */
export const STATUS_RANK: Record<LevelStatus, number> = { reached: 5, veryNear: 4, near: 3, far: 2, veryFar: 1, unknown: 0 };

export function bestStatus(statuses: LevelStatus[]): LevelStatus {
  return statuses.reduce<LevelStatus>((a, s) => (STATUS_RANK[s] > STATUS_RANK[a] ? s : a), 'unknown');
}

/** Días naturales desde `today` hasta `until` (ambos AAAA-MM-DD). */
export function daysBetween(today: string, until: string): number {
  const toUtc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((toUtc(until) - toUtc(today)) / 86_400_000);
}

export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Acciones a comprar: siempre se redondea a la unidad superior (nunca por debajo del importe).
 * El margen evita que errores de coma flotante (200,0000000001) suban una acción de más.
 */
export function roundUpShares(exact: number): number {
  return Math.ceil(exact - 1e-9);
}

export interface MetricsInput {
  item: Item;
  quote: Quote | null;
  targets: AnalystTargets | null;
  /** Unidades de la divisa del valor por 1 de divisa base (1 si coinciden). */
  fxRate: number | null;
  settings: Settings;
  today: string;
}

export function computeMetrics({ item, quote, targets, fxRate, settings, today }: MetricsInput): RowMetrics {
  const price = quote?.price ?? null;
  const levels: LevelView[] = item.buyPrices.map((lp) => ({
    price: lp,
    distancePct: price ? pct(lp, price) : null,
    status: levelStatus(lp, price, settings.bands),
  }));
  const status = bestStatus(levels.map((l) => l.status));
  const pending = levels.filter((l) => l.distancePct != null && l.status !== 'reached');
  const nearestDistancePct =
    status === 'reached' ? 0 : pending.length ? Math.max(...pending.map((l) => l.distancePct!)) : null;

  const investAmount = item.investAmount ?? settings.defaultInvest;
  const entryPrice = item.orderActive && item.orderPrice ? item.orderPrice : (item.buyPrices[0] ?? null);
  const sharesCalc = entryPrice && fxRate ? (investAmount * fxRate) / entryPrice : null;
  const shares = item.sharesOverride ?? (sharesCalc != null ? roundUpShares(sharesCalc) : null);
  const netNative = shares != null && entryPrice ? shares * entryPrice : null;
  const netBase = netNative != null && fxRate ? netNative / fxRate : null;
  const diffBase =
    shares != null && entryPrice && price && fxRate ? (shares * (price - entryPrice)) / fxRate : null;

  const upsideBrokerPct = item.brokerTarget && price ? pct(item.brokerTarget, price) : null;
  const upsideConsensusPct = targets?.mean && price ? pct(targets.mean, price) : null;

  const orderDaysLeft = item.orderActive && item.orderUntil ? daysBetween(today, item.orderUntil) : null;

  return {
    levels,
    status,
    nearestDistancePct,
    fxRate,
    investAmount,
    sharesCalc,
    shares,
    entryPrice,
    netNative,
    netBase,
    diffBase,
    upsideBrokerPct,
    upsideConsensusPct,
    orderDaysLeft,
    orderExpired: orderDaysLeft != null && orderDaysLeft < 0,
  };
}

/** Estado frente al objetivo de venta: alcanzado (precio ≥ objetivo) · cerca (le falta ≤ nearPct %). */
export function sellStatus(target: number | null, price: number | null, nearPct: number): SellStatus {
  if (!target || price == null || price <= 0) return 'none';
  if (price >= target) return 'reached';
  return pct(target, price) * 100 <= nearPct ? 'near' : 'below';
}

/**
 * Métricas de una posición. El coste en divisa base usa lo pagado si se indicó; si no, el cambio
 * actual (aproximado: no tiene en cuenta lo que se ganó o perdió por la divisa).
 */
export function computePositionMetrics(args: {
  position: Position;
  quote: Quote | null;
  fxRate: number | null;
  sellNearPct: number;
}): Omit<PositionMetrics, 'weight'> {
  const { position: p, quote, fxRate, sellNearPct } = args;
  const price = quote?.price ?? null;
  const valueNative = price != null ? p.shares * price : null;
  const valueBase = valueNative != null && fxRate ? valueNative / fxRate : null;
  const costNative = p.shares * p.avgPrice;
  const costBase = p.costBase ?? (fxRate ? costNative / fxRate : null);
  const pnlBase = valueBase != null && costBase != null ? valueBase - costBase : null;
  const pnlPct = pnlBase != null && costBase ? pnlBase / costBase : null;
  const prev = quote?.previousClose ?? (price != null && quote?.changePct != null ? price / (1 + quote.changePct) : null);
  const dayChangeBase = price != null && prev != null && fxRate ? (p.shares * (price - prev)) / fxRate : null;
  return {
    fxRate,
    valueNative,
    valueBase,
    costNative,
    costBase,
    pnlBase,
    pnlPct,
    dayChangeBase,
    sellDistancePct: p.sellTarget && price ? pct(p.sellTarget, price) : null,
    sellStatus: sellStatus(p.sellTarget, price, sellNearPct),
  };
}

/** Totales de la cartera y peso de cada posición. Las que no tienen valor no suman. */
export function portfolioTotals(rows: (Omit<PortfolioRow, 'metrics'> & { metrics: Omit<PositionMetrics, 'weight'> })[]) {
  const priced = rows.filter((r) => r.metrics.valueBase != null && r.metrics.costBase != null);
  const valueBase = priced.reduce((s, r) => s + r.metrics.valueBase!, 0);
  const costBase = priced.reduce((s, r) => s + r.metrics.costBase!, 0);
  const totals: PortfolioTotals = {
    valueBase,
    costBase,
    pnlBase: valueBase - costBase,
    pnlPct: costBase ? (valueBase - costBase) / costBase : null,
    dayChangeBase: priced.reduce((s, r) => s + (r.metrics.dayChangeBase ?? 0), 0),
    missing: rows.length - priced.length,
  };
  const withWeight: PortfolioRow[] = rows.map((r) => ({
    ...r,
    metrics: { ...r.metrics, weight: r.metrics.valueBase != null && valueBase ? r.metrics.valueBase / valueBase : null },
  }));
  return { totals, rows: withWeight };
}
