import { config } from './config.ts';
import { openDatabase, type Db } from './db/database.ts';
import { AlertsService } from './modules/alerts/alerts.service.ts';
import { PushService } from './modules/alerts/push.service.ts';
import { BackupService } from './modules/backup/backup.service.ts';
import { ItemsRepository } from './modules/items/items.repository.ts';
import { ListsRepository } from './modules/lists/lists.repository.ts';
import { MarketService } from './modules/market/market.service.ts';
import type { MarketDataProvider } from './modules/market/provider.ts';
import { YahooProvider } from './modules/market/yahoo.provider.ts';
import { BorsaProvider } from './modules/market/borsa.provider.ts';
import { QuefondosProvider } from './modules/market/quefondos.provider.ts';
import { FallbackProvider } from './modules/market/fallback.provider.ts';
import { PortfolioService } from './modules/portfolio/portfolio.service.ts';
import { InstrumentsRepository, OperationsRepository } from './modules/portfolio/cartera.repository.ts';
import { SettingsRepository, StateRepository } from './modules/settings/settings.repository.ts';
import { WatchlistService } from './modules/watchlist/watchlist.service.ts';

/** Composición de dependencias: único sitio donde se cablea todo. */
export function createServicesFromDb(
  db: Db,
  opts: {
    provider?: MarketDataProvider;
    vapid?: { publicKey: string | null; privateKey: string | null; subject: string };
    log?: (msg: string, err?: unknown) => void;
    market?: MarketService;
    push?: PushService;
  } = {},
) {
  const log = opts.log ?? (() => {});
  const lists = new ListsRepository(db);
  const items = new ItemsRepository(db);
  const settings = new SettingsRepository(db);
  const state = new StateRepository(db);
  const market = opts.market ?? new MarketService(
    opts.provider ?? new FallbackProvider([new YahooProvider(), new BorsaProvider(), new QuefondosProvider()], log),
    db,
    { quoteTtlMs: config.quoteTtlMs, targetsTtlMs: config.targetsTtlMs },
    log,
  );
  const watchlist = new WatchlistService(lists, items, settings, market);
  const operations = new OperationsRepository(db);
  const instruments = new InstrumentsRepository(db);
  const portfolio = new PortfolioService(operations, instruments, settings, market);
  const backup = new BackupService(db);
  const push = opts.push ?? new PushService(db, opts.vapid ?? { publicKey: null, privateKey: null, subject: 'mailto:avisos@raclos.es' }, log);
  const alerts = new AlertsService(db, lists, settings, state, watchlist, push, backup, log);
  return { db, lists, items, settings, state, market, watchlist, operations, instruments, portfolio, backup, push, alerts };
}

export async function createServices(opts: Parameters<typeof createServicesFromDb>[1] = {}) {
  const db = await openDatabase({ url: config.databaseUrl, dataDir: config.dataDir });
  return createServicesFromDb(db, { vapid: config.vapid, ...opts });
}

export type Services = ReturnType<typeof createServicesFromDb>;
