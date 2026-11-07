import type { Settings } from './schemas.ts';
import type { AnalystTargets, Item, LevelStatus, LevelView, Quote, RowMetrics } from './types.ts';

const pct = (to: number, from: number) => (to - from) / from;

export function levelStatus(level: number, price: number | null, nearPct: number): LevelStatus {
  if (price == null || price <= 0) return 'unknown';
  if (price <= level) return 'reached';
  return pct(level, price) >= -nearPct / 100 ? 'near' : 'far';
}

const STATUS_RANK: Record<LevelStatus, number> = { reached: 3, near: 2, far: 1, unknown: 0 };

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
    status: levelStatus(lp, price, settings.nearThresholdPct),
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
