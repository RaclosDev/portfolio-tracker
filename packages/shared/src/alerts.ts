import { STATUS_RANK } from './calc.ts';
import type { LevelStatus, WatchlistRow } from './types.ts';

export type AlertKind = 'reached' | 'near' | 'orderTouched' | 'orderExpiring';

export interface Alert {
  kind: AlertKind;
  itemId: number;
  title: string;
  body: string;
}

export interface AlertPrefs {
  reached: boolean;
  near: boolean;
  orders: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { reached: true, near: true, orders: true };

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
  const recently = (key: string) => {
    const at = next.notified[key];
    return at != null && now.getTime() - Date.parse(at) < ALERT_COOLDOWN_MS;
  };
  const push = (key: string, alert: Alert) => {
    next.notified[key] = now.toISOString();
    alerts.push(alert);
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

  // Olvidar lo de valores que ya no están en ninguna lista
  const ids = new Set(rows.map((r) => String(r.item.id)));
  for (const k of Object.keys(next.levels)) {
    const id = k.startsWith('order:') ? k.split(':')[1] : k.split(':')[0];
    if (!ids.has(id!)) delete next.levels[k];
  }
  return { alerts, memory: next };
}
