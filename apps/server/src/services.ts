import { config } from './config.ts';
import { openDatabase, type Db, type JournalMode } from './db/database.ts';
import { BackupService } from './modules/backup/backup.service.ts';
import { ItemsRepository } from './modules/items/items.repository.ts';
import { ListsRepository } from './modules/lists/lists.repository.ts';
import { MarketService } from './modules/market/market.service.ts';
import type { MarketDataProvider } from './modules/market/provider.ts';
import { YahooProvider } from './modules/market/yahoo.provider.ts';
import { SettingsRepository } from './modules/settings/settings.repository.ts';
import { WatchlistService } from './modules/watchlist/watchlist.service.ts';

/** Composición de dependencias: único sitio donde se cablea todo. */
export function createServices(
  opts: {
    db?: Db;
    dataDir?: string;
    journalMode?: JournalMode;
    provider?: MarketDataProvider;
    log?: (msg: string, err?: unknown) => void;
  } = {},
) {
  const db = opts.db ?? openDatabase(opts.dataDir ?? config.dataDir, { journalMode: opts.journalMode });
  const lists = new ListsRepository(db);
  const items = new ItemsRepository(db);
  const settings = new SettingsRepository(db);
  const market = new MarketService(
    opts.provider ?? new YahooProvider(),
    db,
    { quoteTtlMs: config.quoteTtlMs, targetsTtlMs: config.targetsTtlMs },
    opts.log,
  );
  const watchlist = new WatchlistService(lists, items, settings, market);
  const backup = new BackupService(db, lists, items, settings, opts.db ? null : (opts.dataDir ?? config.dataDir));
  return { db, lists, items, settings, market, watchlist, backup };
}

export type Services = ReturnType<typeof createServices>;
