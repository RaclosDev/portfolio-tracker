import { config } from './config.ts';
import { openDatabase, type Db } from './db/database.ts';
import { AlertsService } from './modules/alerts/alerts.service.ts';
import { PushService } from './modules/alerts/push.service.ts';
import { BackupService } from './modules/backup/backup.service.ts';
import { ItemsRepository } from './modules/items/items.repository.ts';
import { ListsRepository } from './modules/lists/lists.repository.ts';
import { MarketService } from './modules/market/market.service.ts';
import { mergeCatalogs, type InstrumentCatalog, type MarketDataProvider } from './modules/market/provider.ts';
import { YahooProvider } from './modules/market/yahoo.provider.ts';
import { BorsaProvider } from './modules/market/borsa.provider.ts';
import { QuefondosProvider } from './modules/market/quefondos.provider.ts';
import { OnvistaProvider } from './modules/market/onvista.provider.ts';
import { FtProvider } from './modules/market/ft.provider.ts';
import { EuronextCatalog } from './modules/market/euronext.catalog.ts';
import { JustEtfProvider } from './modules/market/justetf.provider.ts';
import { ExtraEtfComposition, FinancialHubComposition, FtComposition, OnvistaComposition, YahooComposition, type CompositionSource } from './modules/market/composition.ts';
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
    catalog?: InstrumentCatalog;
    compositionSources?: CompositionSource[];
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
  // Sin proveedor propio (producción) onvista también hace de catálogo de productos; en los tests no se sale a internet.
  const onvista = opts.provider ? undefined : new OnvistaProvider();
  const yahoo = opts.provider ? undefined : new YahooProvider();
  const financialHub = opts.provider ? undefined : new FinancialHubComposition();
  const market = opts.market ?? new MarketService(
    opts.provider ?? new FallbackProvider([yahoo!, new BorsaProvider(), new QuefondosProvider(), onvista!, new JustEtfProvider(), new FtProvider()], log),
    db,
    { quoteTtlMs: config.quoteTtlMs, targetsTtlMs: config.targetsTtlMs },
    log,
    opts.catalog ?? (onvista && mergeCatalogs([onvista, new EuronextCatalog()], log)),
    opts.compositionSources ?? (yahoo
      ? [financialHub!, new ExtraEtfComposition(), new OnvistaComposition(), new FtComposition(), new YahooComposition((symbol) => yahoo.topHoldings(symbol))]
      : []),
  );
  const watchlist = new WatchlistService(lists, items, settings, market);
  const operations = new OperationsRepository(db);
  const instruments = new InstrumentsRepository(db);
  const portfolio = new PortfolioService(operations, instruments, settings, market);
  const backup = new BackupService(db);
  const push = opts.push ?? new PushService(db, opts.vapid ?? { publicKey: null, privateKey: null, subject: 'mailto:avisos@raclos.es' }, log);
  const alerts = new AlertsService(db, lists, settings, state, watchlist, push, backup, log);
  /** ISIN de un valor por su cotización: el que da la propia cotización o, en fondos y ETF, Financial Hub. */
  const isinOf = async (symbol: string): Promise<string | null> => {
    try {
      const quote = (await market.getQuotes([symbol])).get(symbol);
      return quote?.isin ?? (await financialHub?.isinOf(symbol)) ?? null;
    } catch {
      return null;
    }
  };
  return { db, lists, items, settings, state, market, watchlist, operations, instruments, portfolio, backup, push, alerts, isinOf };
}

export async function createServices(opts: Parameters<typeof createServicesFromDb>[1] = {}) {
  const db = await openDatabase({ url: config.databaseUrl, dataDir: config.dataDir });
  return createServicesFromDb(db, { vapid: config.vapid, ...opts });
}

export type Services = ReturnType<typeof createServicesFromDb>;
