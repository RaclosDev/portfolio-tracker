/**
 * Vigilancia de precios en segundo plano: abre la base de datos SOLO EN LECTURA un instante,
 * calcula el estado de cada valor y decide qué avisar. No bloquea la carpeta de datos, así que
 * la app puede seguir en la bandeja de un PC mientras se usa en otro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emptyMemory, evaluateAlerts, type Alert, type AlertMemory, type AlertPrefs, type WatchlistRow } from '@watchlist/shared';
import { migrate } from '../../server/src/db/database.ts';
import { ItemsRepository } from '../../server/src/modules/items/items.repository.ts';
import { ListsRepository } from '../../server/src/modules/lists/lists.repository.ts';
import { MarketService } from '../../server/src/modules/market/market.service.ts';
import { YahooProvider } from '../../server/src/modules/market/yahoo.provider.ts';
import { SettingsRepository } from '../../server/src/modules/settings/settings.repository.ts';
import { WatchlistService } from '../../server/src/modules/watchlist/watchlist.service.ts';
import { DB_FILE } from './data-folder.ts';

export class PriceWatcher {
  private market: MarketService;
  private memoryFile: string;

  constructor(
    private dataDir: string,
    stateDir: string,
    log: (msg: string, err?: unknown) => void,
  ) {
    // Caché de cotizaciones en memoria: el watcher nunca escribe en la carpeta de datos.
    const cache = new DatabaseSync(':memory:');
    migrate(cache);
    this.market = new MarketService(new YahooProvider(), cache, { quoteTtlMs: 30_000, targetsTtlMs: 12 * 3_600_000 }, log);
    this.memoryFile = path.join(stateDir, 'alertas.json');
  }

  private readMemory(): AlertMemory {
    try {
      return { ...emptyMemory(), ...JSON.parse(fs.readFileSync(this.memoryFile, 'utf8')) };
    } catch {
      return emptyMemory();
    }
  }

  private async loadRows(): Promise<{ rows: WatchlistRow[]; refreshSeconds: number | null }> {
    const file = path.join(this.dataDir, DB_FILE);
    if (!fs.existsSync(file)) return { rows: [], refreshSeconds: null };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const lists = new ListsRepository(db);
      const settings = new SettingsRepository(db);
      const refreshSeconds = settings.get().refreshSeconds;
      const svc = new WatchlistService(lists, new ItemsRepository(db), settings, this.market);
      // view() lee la base de datos de forma síncrona antes de pedir cotizaciones.
      const views = await Promise.all(lists.all().map((l) => svc.view(l.id)));
      const seen = new Set<string>();
      const rows = views
        .flatMap((v) => v?.rows ?? [])
        .filter((r) => (seen.has(r.item.symbol) ? false : (seen.add(r.item.symbol), true)));
      return { rows, refreshSeconds };
    } finally {
      db.close();
    }
  }

  /**
   * Comprueba precios y devuelve los avisos nuevos (y recuerda lo avisado en este PC), junto con
   * la frecuencia de actualización configurada en Ajustes → General para programar la siguiente.
   */
  async check(prefs: AlertPrefs, now = new Date()): Promise<{ alerts: Alert[]; refreshSeconds: number | null }> {
    const { rows, refreshSeconds } = await this.loadRows();
    const { alerts, memory } = evaluateAlerts(rows, this.readMemory(), prefs, now);
    fs.mkdirSync(path.dirname(this.memoryFile), { recursive: true });
    fs.writeFileSync(this.memoryFile, JSON.stringify(memory));
    return { alerts, refreshSeconds };
  }
}
