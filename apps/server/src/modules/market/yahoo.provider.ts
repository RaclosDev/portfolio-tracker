import YahooFinance from 'yahoo-finance2';
import type { MarketDataProvider } from './provider.ts';

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);

// Sin validación estricta: Yahoo cambia campos con frecuencia y no queremos romper por eso.
const LOOSE = { validateResult: false } as const;

export class YahooProvider implements MarketDataProvider {
  readonly id = 'yahoo';
  private yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

  async getQuotes(symbols: string[]) {
    if (!symbols.length) return [];
    const res = (await this.yf.quote(symbols, { return: 'array' }, LOOSE)) as Record<string, unknown>[];
    const now = new Date().toISOString();
    return res.map((q) => ({
      symbol: String(q.symbol),
      name: s(q.longName) ?? s(q.shortName),
      currency: s(q.currency),
      price: n(q.regularMarketPrice),
      changePct: n(q.regularMarketChangePercent) != null ? n(q.regularMarketChangePercent)! / 100 : null,
      previousClose: n(q.regularMarketPreviousClose),
      low52: n(q.fiftyTwoWeekLow),
      high52: n(q.fiftyTwoWeekHigh),
      quoteType: s(q.quoteType),
      exchange: s(q.fullExchangeName) ?? s(q.exchange),
      marketState: s(q.marketState),
      fetchedAt: now,
    }));
  }

  async getTargets(symbol: string) {
    const res = (await this.yf.quoteSummary(symbol, { modules: ['financialData'] }, LOOSE)) as {
      financialData?: Record<string, unknown>;
    };
    const f = res.financialData;
    if (!f || n(f.targetMeanPrice) == null) return null;
    return {
      mean: n(f.targetMeanPrice),
      median: n(f.targetMedianPrice),
      high: n(f.targetHighPrice),
      low: n(f.targetLowPrice),
      analysts: n(f.numberOfAnalystOpinions),
      recommendation: s(f.recommendationKey),
      recommendationMean: n(f.recommendationMean),
    };
  }

  async search(query: string) {
    const res = (await this.yf.search(query, { quotesCount: 12, newsCount: 0 }, LOOSE)) as {
      quotes?: Record<string, unknown>[];
    };
    return (res.quotes ?? [])
      .filter((q) => typeof q.symbol === 'string' && q.isYahooFinance !== false)
      .map((q) => ({
        symbol: String(q.symbol),
        name: s(q.longname) ?? s(q.shortname) ?? String(q.symbol),
        exchange: s(q.exchDisp) ?? s(q.exchange),
        type: s(q.typeDisp) ?? s(q.quoteType),
      }));
  }
}
