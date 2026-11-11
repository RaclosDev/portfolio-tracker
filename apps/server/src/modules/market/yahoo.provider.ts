import type { DailyHistory, HistoryRange, PricePoint } from '@watchlist/shared';
import YahooFinance from 'yahoo-finance2';
import type { MarketDataProvider } from './provider.ts';

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);

// Sin validación estricta: Yahoo cambia campos con frecuencia y no queremos romper por eso.
const LOOSE = { validateResult: false } as const;

interface DailyChart {
  meta?: { currency?: string; exchangeTimezoneName?: string };
  quotes?: { date: Date | string; close?: number | null }[];
  events?: { splits?: { date: Date | string; numerator: number; denominator: number }[] };
}

export function dailyHistoryFromChart(chart: DailyChart): DailyHistory {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: chart.meta?.exchangeTimezoneName ?? 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateOf = (date: Date | string) => day.format(new Date(date));
  const splits = (chart.events?.splits ?? []).filter((s) => s.numerator > 0 && s.denominator > 0)
    .map((s) => ({ date: dateOf(s.date), ratio: s.numerator / s.denominator }));
  return {
    currency: chart.meta?.currency ?? null,
    points: (chart.quotes ?? []).filter((q) => n(q.close) != null && q.close! > 0).map((q) => {
      const t = dateOf(q.date);
      // Yahoo ajusta close por splits posteriores; el registro conserva las acciones de cada día.
      const factor = splits.reduce((v, s) => s.date > t ? v * s.ratio : v, 1);
      return { t, c: q.close! * factor };
    }),
  };
}

/** Días hacia atrás e intervalo de cada periodo del gráfico. */
const RANGES: Record<HistoryRange, { days: number; interval: '1d' | '1wk' }> = {
  '1m': { days: 31, interval: '1d' },
  '3m': { days: 92, interval: '1d' },
  '6m': { days: 183, interval: '1d' },
  '1y': { days: 366, interval: '1d' },
  '5y': { days: 5 * 366, interval: '1wk' },
};

/** Sectores de Yahoo en español. */
const SECTORS: Record<string, string> = {
  Technology: 'Tecnología',
  'Financial Services': 'Financiero',
  Healthcare: 'Salud',
  'Consumer Cyclical': 'Consumo cíclico',
  'Consumer Defensive': 'Consumo básico',
  Industrials: 'Industria',
  Energy: 'Energía',
  Utilities: 'Servicios públicos',
  'Basic Materials': 'Materiales',
  'Real Estate': 'Inmobiliario',
  'Communication Services': 'Telecomunicaciones',
};

/**
 * Valores en los que Yahoo se aparta de la clasificación habitual (GICS) o no da sector.
 * Ej.: Cellnex figura como «Real Estate» por sus torres, pero su negocio es de telecomunicaciones.
 * Lo escrito a mano en la ficha del valor manda siempre sobre esto.
 */
export const SECTOR_OVERRIDES: Record<string, string> = {
  'CLNX.MC': 'Telecomunicaciones',
  'FDR.MC': 'Industria',
  'VID.MC': 'Materiales',
  'VIS.MC': 'Consumo básico',
  'GRF.MC': 'Salud',
  'GRF-P.MC': 'Salud',
  UBER: 'Industria',
};

export class YahooProvider implements MarketDataProvider {
  readonly id = 'yahoo';
  private yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

  async getDailyHistory(symbol: string, from: string): Promise<DailyHistory> {
    const chart = await this.yf.chart(symbol, { period1: from, interval: '1d', events: 'split' }, LOOSE) as DailyChart;
    return dailyHistoryFromChart(chart);
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
    const { days, interval } = RANGES[range];
    const res = (await this.yf.chart(
      symbol,
      { period1: new Date(Date.now() - days * 86_400_000), interval },
      LOOSE,
    )) as { quotes?: { date: Date | string; close?: number | null }[] };
    return (res.quotes ?? [])
      .filter((q) => n(q.close) != null)
      .map((q) => ({ t: new Date(q.date).toISOString(), c: q.close! }));
  }

  async getProfile(symbol: string) {
    const res = (await this.yf.quoteSummary(symbol, { modules: ['assetProfile', 'price'] }, LOOSE)) as {
      assetProfile?: { sector?: unknown };
      price?: { longName?: unknown; shortName?: unknown };
    };
    const raw = s(res.assetProfile?.sector);
    const sector = SECTOR_OVERRIDES[symbol.toUpperCase()] ?? (raw ? (SECTORS[raw] ?? raw) : null);
    const name = s(res.price?.longName) ?? s(res.price?.shortName);
    return sector || name ? { sector, name } : null;
  }

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
    const res = (await this.yf.quoteSummary(
      symbol,
      { modules: ['financialData', 'calendarEvents', 'summaryDetail'] },
      LOOSE,
    )) as {
      financialData?: Record<string, unknown>;
      calendarEvents?: { earnings?: { earningsDate?: unknown[] }; exDividendDate?: unknown };
      summaryDetail?: Record<string, unknown>;
    };
    const f = res.financialData ?? {};
    const d = res.summaryDetail ?? {};
    const iso = (v: unknown) => (v instanceof Date || typeof v === 'string' ? new Date(v).toISOString().slice(0, 10) : null);
    const out = {
      mean: n(f.targetMeanPrice),
      median: n(f.targetMedianPrice),
      high: n(f.targetHighPrice),
      low: n(f.targetLowPrice),
      analysts: n(f.numberOfAnalystOpinions),
      recommendation: s(f.recommendationKey),
      recommendationMean: n(f.recommendationMean),
      nextEarnings: iso(res.calendarEvents?.earnings?.earningsDate?.[0]),
      exDividend: iso(res.calendarEvents?.exDividendDate),
      dividendYield: n(d.dividendYield),
      trailingPE: n(d.trailingPE),
      marketCap: n(d.marketCap),
    };
    return Object.values(out).some((v) => v != null) ? out : null;
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
