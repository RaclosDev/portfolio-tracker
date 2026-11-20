/**
 * Vigilancia de precios en el servidor: cada minuto (o lo que diga Ajustes) calcula el estado de
 * todos los valores de las listas, decide qué avisar, lo guarda en el historial y lo envía como
 * notificación a los dispositivos suscritos. También manda el resumen diario y hace la copia diaria.
 */
import {
  buildDailySummary,
  emptyMemory,
  evaluateAlerts,
  hhmmOf,
  inTimeRange,
  isMuted,
  localToday,
  type Alert,
  type AlertMemory,
  type AlertRecord,
  type TouchedOrder,
  type WatchlistRow,
} from '@watchlist/shared';
import { iso, type Db } from '../../db/database.ts';
import type { BackupService } from '../backup/backup.service.ts';
import type { ListsRepository } from '../lists/lists.repository.ts';
import type { SettingsRepository, StateRepository } from '../settings/settings.repository.ts';
import type { WatchlistService } from '../watchlist/watchlist.service.ts';
import type { PushService } from './push.service.ts';

const HISTORY_KEEP = 500;
const TOUCHED_KEY = 'ordenesTocadas';
const MIN_INTERVAL_S = 60;

export class AlertsService {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  lastCheck: Date | null = null;

  constructor(
    private db: Db,
    private lists: ListsRepository,
    private settings: SettingsRepository,
    private state: StateRepository,
    private watchlist: WatchlistService,
    private push: PushService,
    private backup: BackupService,
    private log: (msg: string, err?: unknown) => void = () => {},
  ) {}

  /** Arranca el bucle (en producción). Cada vuelta programa la siguiente con la frecuencia vigente. */
  start() {
    const loop = async () => {
      let seconds = MIN_INTERVAL_S;
      try {
        seconds = Math.max(MIN_INTERVAL_S, (await this.settings.get()).refreshSeconds);
        await this.tick();
      } catch (err) {
        this.log('Fallo al comprobar precios', err);
      }
      this.timer = setTimeout(loop, seconds * 1000);
    };
    this.timer = setTimeout(loop, 5_000);
  }

  stop() {
    clearTimeout(this.timer);
  }

  /** Una comprobación completa. `force`: ignora fines de semana y horas de silencio (botón «Comprobar ahora»). */
  async tick(now = new Date(), { force = false } = {}): Promise<Alert[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const today = localToday(now);
      await this.dailySnapshot(today);
      const s = await this.settings.get();
      const n = s.notifications;
      const day = now.getDay();
      if (!force) {
        if (n.skipWeekends && (day === 0 || day === 6)) return [];
        if (n.quietHours && inTimeRange(hhmmOf(now), n.quietFrom, n.quietTo)) return [];
      }

      const rows = await this.loadRows();
      this.lastCheck = now;
      // Las órdenes tocadas se apuntan siempre, también con los avisos apagados: quedan para revisarlas en la app.
      await this.recordTouched(rows, now);
      if (!force && !n.enabled) return [];
      const watched = rows.filter((r) => !isMuted(r.item.mutedUntil, today));
      const prefs = { reached: n.reached, near: n.near, orders: n.orders };

      const before = await this.state.get<AlertMemory & { bands?: string }>('avisos', emptyMemory());
      // Si han cambiado los tramos, el primer repaso solo recoloca los estados: mover un umbral no es
      // que el precio se haya acercado, así que no se avisa de «muy cerca» (sí de «en zona»).
      const bands = `${s.bands.veryNear}/${s.bands.near}/${s.bands.far}`;
      const rebase = before.bands !== bands;
      const buy = evaluateAlerts(watched, before, prefs, now);
      const alerts = buy.alerts.filter((a) => !(rebase && a.kind === 'near'));
      const memory = { ...buy.memory, bands };
      if (JSON.stringify(memory) !== JSON.stringify(before)) await this.state.set('avisos', memory);

      if (alerts.length) {
        await this.saveHistory(alerts);
        for (const a of alerts) {
          await this.push.sendAll({ title: a.title, body: a.body, tag: `${a.kind}-${a.itemId}`, url: '/' });
        }
        this.log(`${alerts.length} aviso(s): ${alerts.map((a) => a.title).join(' | ')}`);
      }

      // Resumen del día: una vez, a partir de la hora elegida.
      if (n.dailySummary && hhmmOf(now) >= n.dailySummaryAt && (await this.state.get('ultimoResumen', '')) !== today) {
        const summary = buildDailySummary(rows, now, s.statusNames);
        const res = summary ? await this.push.sendAll({ ...summary, tag: 'resumen', url: '/' }) : null;
        // Solo se da por enviado si llegó a algún dispositivo (o no había a quién): si fallan todos, se reintenta en la siguiente vuelta.
        if (!res || res.sent > 0 || res.failed === 0) await this.state.set('ultimoResumen', today);
      }
      return alerts;
    } finally {
      this.running = false;
    }
  }

  private async loadRows(): Promise<WatchlistRow[]> {
    const lists = await this.lists.all();
    const views = await Promise.all(lists.map((l) => this.watchlist.view(l.id)));
    // Un mismo valor puede estar en varias listas con niveles distintos: se evalúa cada uno.
    return views.flatMap((v) => v?.rows ?? []);
  }

  /** Apunta las órdenes activas cuyo precio ya ha tocado la cotización (una vez por orden y precio). */
  async recordTouched(rows: WatchlistRow[], now = new Date()) {
    const before = await this.state.get<TouchedOrder[]>(TOUCHED_KEY, []);
    const next = [...before];
    for (const { item, quote, metrics } of rows) {
      const price = quote?.stale ? null : quote?.price;
      if (!item.orderActive || !item.orderPrice || price == null || price > item.orderPrice) continue;
      if (next.some((o) => o.itemId === item.id && o.orderPrice === item.orderPrice)) continue;
      next.push({
        itemId: item.id,
        listId: item.listId,
        symbol: item.symbol,
        ticker: item.ticker,
        isin: item.isin ?? quote?.isin ?? null,
        name: item.name ?? quote?.name ?? null,
        currency: quote?.currency ?? 'EUR',
        orderPrice: item.orderPrice,
        price,
        shares: item.sharesOverride ?? metrics.shares ?? null,
        broker: item.brokerName,
        at: now.toISOString(),
      });
    }
    if (next.length !== before.length) await this.state.set(TOUCHED_KEY, next);
  }

  /** Órdenes tocadas pendientes de revisar. Se olvidan solas si la orden se quita o cambia de precio. */
  async touchedOrders(): Promise<TouchedOrder[]> {
    const saved = await this.state.get<TouchedOrder[]>(TOUCHED_KEY, []);
    if (!saved.length) return [];
    const live = await this.db.query<{ id: number; order_active: boolean; order_price: string | number | null }>(
      'SELECT id, order_active, order_price FROM items WHERE id = ANY($1::int[])',
      [saved.map((o) => o.itemId)],
    );
    const still = saved.filter((o) =>
      live.some((r) => r.id === o.itemId && r.order_active && r.order_price != null && Number(r.order_price) === o.orderPrice),
    );
    if (still.length !== saved.length) await this.state.set(TOUCHED_KEY, still);
    return still.filter((o) => !o.dismissed);
  }

  /**
   * Descarta una orden tocada (ya apuntada en la cartera o no se ejecutó). Se recuerda como descartada mientras
   * la orden siga activa a ese precio, para que no vuelva a salir en la siguiente vuelta.
   */
  async dismissTouched(itemId: number) {
    const saved = await this.state.get<TouchedOrder[]>(TOUCHED_KEY, []);
    if (!saved.some((o) => o.itemId === itemId && !o.dismissed)) return;
    await this.state.set(TOUCHED_KEY, saved.map((o) => (o.itemId === itemId ? { ...o, dismissed: true } : o)));
  }

  private async saveHistory(alerts: Alert[]) {
    await this.db.tx(async (t) => {
      for (const a of alerts) {
        await t.query('INSERT INTO alert_history (kind, item_id, symbol, title, body) VALUES ($1, $2, $3, $4, $5)', [
          a.kind,
          a.itemId,
          a.symbol,
          a.title,
          a.body,
        ]);
      }
      await t.query('DELETE FROM alert_history WHERE id NOT IN (SELECT id FROM alert_history ORDER BY id DESC LIMIT $1)', [
        HISTORY_KEEP,
      ]);
    });
  }

  async history(limit = 200): Promise<AlertRecord[]> {
    const rows = await this.db.query<{ at: Date; kind: Alert['kind']; item_id: number; symbol: string; title: string; body: string }>(
      'SELECT at, kind, item_id, symbol, title, body FROM alert_history ORDER BY id DESC LIMIT $1',
      [limit],
    );
    return rows.map((r) => ({ at: iso(r.at), kind: r.kind, itemId: r.item_id, symbol: r.symbol, title: r.title, body: r.body, host: 'servidor' }));
  }

  /** Una copia completa al día dentro de la base de datos (se guardan las últimas). */
  private async dailySnapshot(today: string) {
    if ((await this.state.get('ultimaCopia', '')) === today) return;
    // Primero la copia y luego la marca: si la copia falla, se vuelve a intentar en la siguiente vuelta.
    await this.backup.snapshot('diaria', undefined, { skipIfEmpty: true });
    await this.state.set('ultimaCopia', today);
  }
}
