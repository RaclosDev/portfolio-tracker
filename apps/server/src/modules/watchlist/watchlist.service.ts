import { computeMetrics, itemInputSchema, localToday, VISITED_LIST_ID, VISITED_LIST_NAME, type Item, type VisitedSymbol, type WatchList, type WatchlistView } from '@watchlist/shared';
import type { ItemsRepository } from '../items/items.repository.ts';
import type { ListsRepository } from '../lists/lists.repository.ts';
import type { MarketService } from '../market/market.service.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';

export const NO_ANALYST_COVERAGE = new Set(['ETF', 'MUTUALFUND', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE']);

export class WatchlistService {
  constructor(
    private lists: ListsRepository,
    private items: ItemsRepository,
    private settings: SettingsRepository,
    private market: MarketService,
  ) {}

  /** `maxAgeMs`: antigüedad máxima de los precios (más corta con la lista en pantalla, ver `MarketService.getQuotes`). */
  async view(listId: number, { force = false, maxAgeMs }: { force?: boolean; maxAgeMs?: number } = {}): Promise<WatchlistView | undefined> {
    const list = await this.lists.byId(listId);
    if (!list) return undefined;
    return this.build(list, await this.items.byList(listId), { force, maxAgeMs });
  }

  /** La lista «Visitados»: filas sin precios de compra montadas con lo abierto desde el buscador. */
  async visited(entries: VisitedSymbol[], opts: { force?: boolean; maxAgeMs?: number } = {}): Promise<WatchlistView> {
    // Un símbolo que ya no pase la validación se salta en vez de tumbar toda la vista.
    const items: Item[] = entries.flatMap((e, i) => {
      const base = itemInputSchema.safeParse({ listId: 1, symbol: e.symbol });
      if (!base.success) return [];
      return [{ ...base.data, listId: VISITED_LIST_ID, name: e.name || null, isin: e.isin ?? null, id: -(i + 1), createdAt: e.visitedAt, updatedAt: e.visitedAt }];
    });
    return this.build({ id: VISITED_LIST_ID, name: VISITED_LIST_NAME, itemCount: items.length }, items, opts);
  }

  private async build(list: WatchList, items: Item[], { force = false, maxAgeMs }: { force?: boolean; maxAgeMs?: number }): Promise<WatchlistView> {
    const settings = await this.settings.get();
    const symbols = items.map((i) => i.symbol);

    const quotes = await this.market.getQuotes(symbols, { force, maxAgeMs });
    const equitySymbols = symbols.filter((s) => !NO_ANALYST_COVERAGE.has(quotes.get(s)?.quoteType ?? ''));
    const fxStale = new Set<string>();
    const [targets, fx] = await Promise.all([
      // El consenso cambia poco: no se fuerza su refresco (caché de horas).
      this.market.getTargets(equitySymbols),
      this.market.getFxRates(
        settings.baseCurrency,
        [...quotes.values()].map((q) => q.currency),
        undefined,
        fxStale,
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
      fxStale: [...fxStale],
      generatedAt: new Date().toISOString(),
      throttledUntil: this.market.throttledUntilIso,
    };
  }
}
