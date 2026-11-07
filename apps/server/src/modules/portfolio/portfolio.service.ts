import { computePositionMetrics, portfolioTotals, type PortfolioView } from '@watchlist/shared';
import type { MarketService } from '../market/market.service.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';
import { NO_ANALYST_COVERAGE } from '../watchlist/watchlist.service.ts';
import type { PositionsRepository } from './positions.repository.ts';

/** Cartera real: posiciones con su valor actual, plusvalía y distancia al objetivo de venta. */
export class PortfolioService {
  constructor(
    private positions: PositionsRepository,
    private settings: SettingsRepository,
    private market: MarketService,
  ) {}

  async view({ force = false } = {}): Promise<PortfolioView> {
    const settings = this.settings.get();
    const positions = this.positions.all();
    const symbols = positions.map((p) => p.symbol);
    const quotes = await this.market.getQuotes(symbols, { force });
    const equity = symbols.filter((s) => !NO_ANALYST_COVERAGE.has(quotes.get(s)?.quoteType ?? ''));
    const [targets, fx] = await Promise.all([
      this.market.getTargets(equity),
      this.market.getFxRates(
        settings.baseCurrency,
        [...quotes.values()].map((q) => q.currency),
      ),
    ]);

    const partial = positions.map((position) => {
      const quote = quotes.get(position.symbol) ?? null;
      const fxRate = quote?.currency ? (fx[quote.currency] ?? null) : null;
      return {
        position: { ...position, name: position.name ?? quote?.name ?? null },
        quote,
        targets: targets.get(position.symbol) ?? null,
        metrics: computePositionMetrics({ position, quote, fxRate, sellNearPct: settings.sellNearPct }),
      };
    });
    const { rows, totals } = portfolioTotals(partial);
    return {
      settings,
      rows,
      totals,
      fx,
      generatedAt: new Date().toISOString(),
      throttledUntil: this.market.throttledUntilIso,
    };
  }
}
