/**
 * Vigilancia de precios en segundo plano: abre la base de datos SOLO EN LECTURA un instante,
 * calcula el estado de cada valor y decide qué avisar. No bloquea la carpeta de datos, así que
 * la app puede seguir en la bandeja de un PC mientras se usa en otro.
 *
 * Lo ya avisado y el historial se guardan en la carpeta de datos (compartida): así, si la app está
 * en la bandeja de dos PCs, un aviso sale una sola vez. Si la carpeta no está disponible, se usa la
 * carpeta local de la app.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ALERT_HISTORY_FILE,
  emptyMemory,
  evaluateAlerts,
  evaluateSellAlerts,
  isMuted,
  localToday,
  type Alert,
  type AlertMemory,
  type AlertPrefs,
  type AlertRecord,
  type PortfolioRow,
  type WatchlistRow,
} from '@watchlist/shared';
import { migrate } from '../../server/src/db/database.ts';
import { ItemsRepository } from '../../server/src/modules/items/items.repository.ts';
import { ListsRepository } from '../../server/src/modules/lists/lists.repository.ts';
import { PortfolioService } from '../../server/src/modules/portfolio/portfolio.service.ts';
import { PositionsRepository } from '../../server/src/modules/portfolio/positions.repository.ts';
import { MarketService } from '../../server/src/modules/market/market.service.ts';
import { YahooProvider } from '../../server/src/modules/market/yahoo.provider.ts';
import { SettingsRepository } from '../../server/src/modules/settings/settings.repository.ts';
import { WatchlistService } from '../../server/src/modules/watchlist/watchlist.service.ts';
import { DB_FILE } from './data-folder.ts';

export const MEMORY_FILE = 'avisos-estado.json';
export const HISTORY_FILE = ALERT_HISTORY_FILE;
const HISTORY_MAX = 300;

export interface CheckResult {
  alerts: Alert[];
  rows: WatchlistRow[];
  portfolio: PortfolioRow[];
  refreshSeconds: number | null;
}

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) } as T;
  } catch {
    return fallback;
  }
};

export class PriceWatcher {
  private market: MarketService;

  constructor(
    private dataDir: string,
    private stateDir: string,
    log: (msg: string, err?: unknown) => void,
  ) {
    // Caché de cotizaciones en memoria: el watcher nunca escribe en la base de datos.
    const cache = new DatabaseSync(':memory:');
    migrate(cache);
    this.market = new MarketService(new YahooProvider(), cache, { quoteTtlMs: 30_000, targetsTtlMs: 12 * 3_600_000 }, log);
  }

  /** Carpeta donde guardar estado e historial: la de datos si está disponible, si no la local. */
  private stateFolder() {
    return fs.existsSync(this.dataDir) ? this.dataDir : this.stateDir;
  }

  private async loadRows(): Promise<{ rows: WatchlistRow[]; portfolio: PortfolioRow[]; refreshSeconds: number | null }> {
    const file = path.join(this.dataDir, DB_FILE);
    if (!fs.existsSync(file)) return { rows: [], portfolio: [], refreshSeconds: null };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const lists = new ListsRepository(db);
      const settings = new SettingsRepository(db);
      const refreshSeconds = settings.get().refreshSeconds;
      const svc = new WatchlistService(lists, new ItemsRepository(db), settings, this.market);
      // view() lee la base de datos de forma síncrona antes de pedir cotizaciones.
      const portfolioSvc = new PortfolioService(new PositionsRepository(db), settings, this.market);
      const [views, portfolio] = await Promise.all([
        Promise.all(lists.all().map((l) => svc.view(l.id))),
        portfolioSvc.view(),
      ]);
      const seen = new Set<string>();
      const rows = views
        .flatMap((v) => v?.rows ?? [])
        .filter((r) => (seen.has(r.item.symbol) ? false : (seen.add(r.item.symbol), true)));
      return { rows, portfolio: portfolio.rows, refreshSeconds };
    } finally {
      db.close();
    }
  }

  /**
   * Comprueba precios y devuelve los avisos nuevos (y recuerda lo avisado), junto con los valores
   * y la frecuencia de actualización configurada en Ajustes → General.
   */
  async check(prefs: AlertPrefs, now = new Date()): Promise<CheckResult> {
    const { rows, portfolio, refreshSeconds } = await this.loadRows();
    const today = localToday(now);
    const watched = rows.filter((r) => !isMuted(r.item.mutedUntil, today));
    const held = portfolio.filter((r) => !isMuted(r.position.mutedUntil, today));

    const folder = this.stateFolder();
    const memoryFile = path.join(folder, MEMORY_FILE);
    const before = readJson<AlertMemory>(memoryFile, emptyMemory());
    const buy = evaluateAlerts(watched, before, prefs, now);
    const sell = evaluateSellAlerts(held, buy.memory, prefs, now);
    const alerts = [...buy.alerts, ...sell.alerts];
    const memory = sell.memory;
    // Solo se escribe si algo cambia: evita sincronizar la carpeta compartida cada minuto.
    const serialized = JSON.stringify(memory);
    if (serialized !== JSON.stringify({ ...emptyMemory(), ...before })) fs.writeFileSync(memoryFile, serialized);
    if (alerts.length) this.appendHistory(folder, alerts, now);
    return { alerts, rows, portfolio, refreshSeconds };
  }

  private appendHistory(folder: string, alerts: Alert[], now: Date) {
    const file = path.join(folder, HISTORY_FILE);
    let history: AlertRecord[] = [];
    try {
      history = JSON.parse(fs.readFileSync(file, 'utf8')) as AlertRecord[];
    } catch {
      /* primer aviso */
    }
    const at = now.toISOString();
    history.push(...alerts.map((a) => ({ ...a, at, host: os.hostname() })));
    fs.writeFileSync(file, JSON.stringify(history.slice(-HISTORY_MAX), null, 1));
  }
}
