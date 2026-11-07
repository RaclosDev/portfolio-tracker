/**
 * Vigilancia de precios en el servidor: cada minuto (o lo que diga Ajustes) calcula el estado de
 * todos los valores y de la cartera, decide qué avisar, lo guarda en el historial y lo envía como
 * notificación a los dispositivos suscritos. También manda el resumen diario y hace la copia diaria.
 */
import {
  buildDailySummary,
  emptyMemory,
  evaluateAlerts,
  evaluateSellAlerts,
  hhmmOf,
  inTimeRange,
  isMuted,
  localToday,
  type Alert,
  type AlertMemory,
  type AlertRecord,
  type PortfolioRow,
  type WatchlistRow,
} from '@watchlist/shared';
import { iso, type Db } from '../../db/database.ts';
import type { BackupService } from '../backup/backup.service.ts';
import type { ListsRepository } from '../lists/lists.repository.ts';
import type { PortfolioService } from '../portfolio/portfolio.service.ts';
import type { SettingsRepository, StateRepository } from '../settings/settings.repository.ts';
import type { WatchlistService } from '../watchlist/watchlist.service.ts';
import type { PushService } from './push.service.ts';

const HISTORY_KEEP = 500;
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
    private portfolio: PortfolioService,
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
        if (!n.enabled) return [];
        if (n.skipWeekends && (day === 0 || day === 6)) return [];
        if (n.quietHours && inTimeRange(hhmmOf(now), n.quietFrom, n.quietTo)) return [];
      }

      const { rows, portfolio } = await this.loadRows();
      this.lastCheck = now;
      const watched = rows.filter((r) => !isMuted(r.item.mutedUntil, today));
      const held = portfolio.filter((r) => !isMuted(r.position.mutedUntil, today));
      const prefs = { reached: n.reached, near: n.near, orders: n.orders, sell: n.sell };

      const before = await this.state.get<AlertMemory>('avisos', emptyMemory());
      const buy = evaluateAlerts(watched, before, prefs, now);
      const sell = evaluateSellAlerts(held, buy.memory, prefs, now);
      const alerts = [...buy.alerts, ...sell.alerts];
      if (JSON.stringify(sell.memory) !== JSON.stringify(before)) await this.state.set('avisos', sell.memory);

      if (alerts.length) {
        await this.saveHistory(alerts);
        for (const a of alerts) {
          await this.push.sendAll({ title: a.title, body: a.body, tag: `${a.kind}-${a.itemId}`, url: '/' });
        }
        this.log(`${alerts.length} aviso(s): ${alerts.map((a) => a.title).join(' | ')}`);
      }

      // Resumen del día: una vez, a partir de la hora elegida.
      if (n.dailySummary && hhmmOf(now) >= n.dailySummaryAt && (await this.state.get('ultimoResumen', '')) !== today) {
        await this.state.set('ultimoResumen', today);
        const summary = buildDailySummary(rows, now, portfolio);
        if (summary) await this.push.sendAll({ ...summary, tag: 'resumen', url: '/' });
      }
      return alerts;
    } finally {
      this.running = false;
    }
  }

  private async loadRows(): Promise<{ rows: WatchlistRow[]; portfolio: PortfolioRow[] }> {
    const lists = await this.lists.all();
    const [views, pf] = await Promise.all([Promise.all(lists.map((l) => this.watchlist.view(l.id))), this.portfolio.view()]);
    const seen = new Set<string>();
    const rows = views
      .flatMap((v) => v?.rows ?? [])
      .filter((r) => (seen.has(r.item.symbol) ? false : (seen.add(r.item.symbol), true)));
    return { rows, portfolio: pf.rows };
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
    await this.state.set('ultimaCopia', today);
    await this.backup.snapshot('diaria', undefined, { skipIfEmpty: true });
  }
}
