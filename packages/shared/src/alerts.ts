import { STATUS_RANK } from './calc.ts';
import type { LevelStatus, PortfolioRow, WatchlistRow } from './types.ts';

export type AlertKind = 'reached' | 'near' | 'orderTouched' | 'orderExpiring' | 'sellReached' | 'sellNear';

export interface Alert {
  kind: AlertKind;
  itemId: number;
  symbol: string;
  title: string;
  body: string;
}

/** Entrada del historial de avisos (se guarda en la carpeta de datos, compartida entre PCs). */
export interface AlertRecord extends Alert {
  at: string;
  /** PC que mostró el aviso. */
  host: string;
}

/** ¿Están silenciados los avisos de este valor hoy? (`mutedUntil` incluido) */
export function isMuted(mutedUntil: string | null | undefined, today: string): boolean {
  if (!mutedUntil) return false;
  return mutedUntil === 'always' || mutedUntil >= today;
}

/** Texto del resumen diario (una sola notificación con lo importante). */
export function buildDailySummary(
  rows: WatchlistRow[],
  today = new Date(),
  portfolio: PortfolioRow[] = [],
): { title: string; body: string } | null {
  if (!rows.length && !portfolio.length) return null;
  const name = (r: WatchlistRow) => r.item.name ?? r.quote?.name ?? r.item.symbol;
  const reached = rows.filter((r) => r.metrics.status === 'reached');
  const near = rows.filter((r) => r.metrics.status === 'near');
  const expiring = rows.filter((r) => r.item.orderActive && r.metrics.orderDaysLeft != null && r.metrics.orderDaysLeft <= 3);
  const parts: string[] = [];
  if (reached.length) parts.push(`En zona: ${reached.map(name).join(', ')}.`);
  if (near.length) parts.push(`Cerca: ${near.map(name).join(', ')}.`);
  if (expiring.length)
    parts.push(
      `Órdenes por caducar: ${expiring.map((r) => `${name(r)} (${r.metrics.orderDaysLeft! < 0 ? 'caducada' : `${r.metrics.orderDaysLeft} d`})`).join(', ')}.`,
    );
  // Resultados hoy o mañana: suele haber movimientos fuertes de precio.
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const earnings = rows
    .map((r) => ({ r, days: r.targets?.nextEarnings ? Math.round((Date.parse(r.targets.nextEarnings) - t0) / 86_400_000) : null }))
    .filter((x) => x.days === 0 || x.days === 1);
  if (!parts.length) {
    const nearest = rows
      .filter((r) => r.metrics.nearestDistancePct != null)
      .sort((a, b) => b.metrics.nearestDistancePct! - a.metrics.nearestDistancePct!)[0];
    parts.push(
      nearest
        ? `Nada en zona ni cerca. Lo más próximo: ${name(nearest)}, a un ${pctText(nearest.metrics.nearestDistancePct!)}.`
        : 'Nada en zona ni cerca.',
    );
  }
  const toSell = portfolio.filter((r) => r.metrics.sellStatus === 'reached');
  if (toSell.length) parts.push(`Objetivo de venta alcanzado: ${toSell.map((r) => r.position.name ?? r.position.symbol).join(', ')}.`);
  if (earnings.length)
    parts.push(`Resultados: ${earnings.map((x) => `${name(x.r)} (${x.days === 0 ? 'hoy' : 'mañana'})`).join(', ')}.`);
  return { title: 'Watchlist: resumen de hoy', body: parts.join(' ') };
}

export interface AlertPrefs {
  reached: boolean;
  near: boolean;
  orders: boolean;
  /** Objetivo de venta alcanzado o cerca (cartera). */
  sell: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { reached: true, near: true, orders: true, sell: true };

/**
 * Lo que cada PC recuerda entre comprobaciones: el último estado visto de cada nivel
 * y cuándo se avisó de cada cosa (para no repetir avisos).
 */
export interface AlertMemory {
  levels: Record<string, LevelStatus>;
  notified: Record<string, string>;
}

export const emptyMemory = (): AlertMemory => ({ levels: {}, notified: {} });

/** No se repite el mismo aviso antes de este tiempo aunque el precio oscile en el límite. */
export const ALERT_COOLDOWN_MS = 12 * 3_600_000;

function money(v: number, currency: string | null) {
  const cur = currency === 'GBp' ? 'GBP' : currency;
  const value = currency === 'GBp' ? v / 100 : v;
  try {
    return new Intl.NumberFormat('es-ES', {
      style: cur ? 'currency' : 'decimal',
      currency: cur ?? undefined,
      maximumFractionDigits: Math.abs(value) < 10 ? 3 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

const pctText = (v: number) => `${Math.abs(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;

/**
 * Compara el estado actual con el recordado y devuelve los avisos nuevos.
 * Solo avisa cuando algo empeora hacia la compra (lejos → cerca → en zona), una vez.
 */
export function evaluateAlerts(
  rows: WatchlistRow[],
  memory: AlertMemory,
  prefs: AlertPrefs,
  now: Date,
): { alerts: Alert[]; memory: AlertMemory } {
  const next: AlertMemory = { levels: { ...memory.levels }, notified: { ...memory.notified } };
  const alerts: Alert[] = [];
  const symbols = new Map(rows.map((r) => [r.item.id, r.item.symbol]));
  const recently = (key: string) => {
    const at = next.notified[key];
    return at != null && now.getTime() - Date.parse(at) < ALERT_COOLDOWN_MS;
  };
  const push = (key: string, alert: Omit<Alert, 'symbol'>) => {
    next.notified[key] = now.toISOString();
    alerts.push({ ...alert, symbol: symbols.get(alert.itemId) ?? '' });
  };

  for (const { item, quote, metrics } of rows) {
    const price = quote?.price;
    if (price == null || quote?.stale) continue; // sin dato fresco no se avisa
    const name = item.name ?? quote?.name ?? item.symbol;
    const cur = quote?.currency ?? null;

    // Niveles de compra
    metrics.levels.forEach((level, i) => {
      if (level.status === 'unknown') return;
      const key = `${item.id}:${i}:${level.price}`;
      const prev = next.levels[key];
      next.levels[key] = level.status;
      // Primera vez que se ve este nivel (valor nuevo o nivel editado): avisa si ya está cerca o en zona.
      const worsened =
        prev == null ? level.status === 'reached' || level.status === 'near' : STATUS_RANK[level.status] > STATUS_RANK[prev];
      if (!worsened) return;
      const noteKey = `${key}:${level.status}`;
      if (recently(noteKey)) return;
      if (level.status === 'reached' && prefs.reached) {
        push(noteKey, {
          kind: 'reached',
          itemId: item.id,
          title: `${name}: en zona de compra`,
          body: `Cotiza a ${money(price, cur)}, por debajo de tu compra ${i + 1} (${money(level.price, cur)}).`,
        });
      } else if (level.status === 'near' && prefs.near && level.distancePct != null) {
        push(noteKey, {
          kind: 'near',
          itemId: item.id,
          title: `${name}: cerca de tu compra ${i + 1}`,
          body: `Cotiza a ${money(price, cur)}; le falta caer un ${pctText(level.distancePct)} hasta ${money(level.price, cur)}.`,
        });
      }
    });

    if (!prefs.orders || !item.orderActive) continue;

    // Precio en la orden puesta en el banco
    if (item.orderPrice) {
      const key = `order:${item.id}:${item.orderPrice}`;
      const status: LevelStatus = price <= item.orderPrice ? 'reached' : 'far';
      const prev = next.levels[key];
      next.levels[key] = status;
      if (status === 'reached' && prev !== 'reached' && !recently(`${key}:reached`)) {
        push(`${key}:reached`, {
          kind: 'orderTouched',
          itemId: item.id,
          title: `${name}: precio en tu orden`,
          body: `Cotiza a ${money(price, cur)}, en tu orden de ${money(item.orderPrice, cur)}. Comprueba en el banco si se ha ejecutado.`,
        });
      }
    }

    // Orden a punto de caducar o caducada (un aviso por día restante)
    const days = metrics.orderDaysLeft;
    if (item.orderUntil && days != null && days <= 2) {
      const key = `expira:${item.id}:${item.orderUntil}:${Math.max(days, -1)}`;
      if (!next.notified[key]) {
        const when = days < 0 ? 'ha caducado' : days === 0 ? 'caduca hoy' : days === 1 ? 'caduca mañana' : `caduca en ${days} días`;
        push(key, {
          kind: 'orderExpiring',
          itemId: item.id,
          title: `${name}: la orden ${when}`,
          body: days < 0 ? 'Renuévala en el banco o quítala de la app.' : 'Renuévala en el banco si quieres mantenerla.',
        });
      }
    }
  }

  // Olvidar lo de valores que ya no están en ninguna lista (lo de la cartera lo gestiona evaluateSellAlerts)
  const ids = new Set(rows.map((r) => String(r.item.id)));
  for (const k of Object.keys(next.levels)) {
    if (k.startsWith('sell:')) continue;
    const id = k.startsWith('order:') ? k.split(':')[1] : k.split(':')[0];
    if (!ids.has(id!)) delete next.levels[k];
  }
  return { alerts, memory: next };
}

/**
 * Avisos de la cartera: el precio llega al objetivo de venta o se queda cerca.
 * Misma lógica que los de compra: solo al empeorar hacia la venta y una vez cada 12 h.
 */
export function evaluateSellAlerts(
  rows: PortfolioRow[],
  memory: AlertMemory,
  prefs: AlertPrefs,
  now: Date,
): { alerts: Alert[]; memory: AlertMemory } {
  const next: AlertMemory = { levels: { ...memory.levels }, notified: { ...memory.notified } };
  const alerts: Alert[] = [];
  const rank = { none: 0, below: 1, near: 2, reached: 3 } as const;

  for (const { position: p, quote, metrics } of rows) {
    const price = quote?.price;
    if (!p.sellTarget || price == null || quote?.stale || metrics.sellStatus === 'none') continue;
    const key = `sell:${p.id}:${p.sellTarget}`;
    const status = metrics.sellStatus;
    const prev = next.levels[key] as keyof typeof rank | undefined;
    next.levels[key] = status as LevelStatus;
    const worsened = prev == null ? status !== 'below' : rank[status] > (rank[prev] ?? 0);
    if (!worsened || !prefs.sell) continue;
    const noteKey = `${key}:${status}`;
    const at = next.notified[noteKey];
    if (at != null && now.getTime() - Date.parse(at) < ALERT_COOLDOWN_MS) continue;
    next.notified[noteKey] = now.toISOString();
    const name = p.name ?? quote?.name ?? p.symbol;
    const cur = quote?.currency ?? null;
    const pnl = metrics.pnlPct != null ? ` Plusvalía: ${metrics.pnlPct >= 0 ? '+' : '−'}${pctText(metrics.pnlPct)}.` : '';
    alerts.push(
      status === 'reached'
        ? {
            kind: 'sellReached',
            itemId: p.id,
            symbol: p.symbol,
            title: `${name}: objetivo de venta alcanzado`,
            body: `Cotiza a ${money(price, cur)}, por encima de tu objetivo (${money(p.sellTarget, cur)}).${pnl}`,
          }
        : {
            kind: 'sellNear',
            itemId: p.id,
            symbol: p.symbol,
            title: `${name}: cerca de tu objetivo de venta`,
            body: `Cotiza a ${money(price, cur)}; le falta subir un ${pctText(metrics.sellDistancePct ?? 0)} hasta ${money(p.sellTarget, cur)}.${pnl}`,
          },
    );
  }

  const ids = new Set(rows.map((r) => String(r.position.id)));
  for (const k of Object.keys(next.levels)) {
    if (k.startsWith('sell:') && !ids.has(k.split(':')[1]!)) delete next.levels[k];
  }
  return { alerts, memory: next };
}

/** Fichero del historial de avisos dentro de la carpeta de datos. */
export const ALERT_HISTORY_FILE = 'avisos-historial.json';

/** ¿Está la hora "HH:MM" dentro del tramo [from, to)? Admite tramos que cruzan la medianoche. */
export function inTimeRange(hhmm: string, from: string, to: string) {
  if (from === to) return false;
  return from < to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to;
}

/** Hora local "HH:MM". */
export const hhmmOf = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
