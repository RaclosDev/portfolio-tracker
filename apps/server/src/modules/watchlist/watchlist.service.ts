import { computeMetrics, localToday, type WatchlistView } from '@watchlist/shared';
import type { ItemsRepository } from '../items/items.repository.ts';
import type { ListsRepository } from '../lists/lists.repository.ts';
import type { MarketService } from '../market/market.service.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';

const NO_ANALYST_COVERAGE = new Set(['ETF', 'MUTUALFUND', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE']);

export class WatchlistService {
  constructor(
    private lists: ListsRepository,
    private items: ItemsRepository,
    private settings: SettingsRepository,
    private market: MarketService,
  ) {}

  async view(listId: number, { force = false } = {}): Promise<WatchlistView | undefined> {
    const list = this.lists.byId(listId);
    if (!list) return undefined;
    const settings = this.settings.get();
    const items = this.items.byList(listId);
    const symbols = items.map((i) => i.symbol);

    const quotes = await this.market.getQuotes(symbols, { force });
    const equitySymbols = symbols.filter((s) => !NO_ANALYST_COVERAGE.has(quotes.get(s)?.quoteType ?? ''));
    const [targets, fx] = await Promise.all([
      // El consenso cambia poco: no se fuerza su refresco (caché de horas).
      this.market.getTargets(equitySymbols),
      this.market.getFxRates(
        settings.baseCurrency,
        [...quotes.values()].map((q) => q.currency),
      ),
    ]);

    const today = localToday();
    const rows = items.map((item) => {
      const quote = quotes.get(item.symbol) ?? null;
      const t = targets.get(item.symbol) ?? null;
      const fxRate = quote?.currency ? (fx[quote.currency] ?? null) : null;
      return {
        item: { ...item, name: item.name ?? quote?.name ?? null },
        quote,
        targets: t,
        metrics: computeMetrics({ item, quote, targets: t, fxRate, settings, today }),
      };
    });

    return {
      list,
      settings,
      rows,
      fx,
      generatedAt: new Date().toISOString(),
      throttledUntil: this.market.throttledUntilIso,
    };
  }
}
