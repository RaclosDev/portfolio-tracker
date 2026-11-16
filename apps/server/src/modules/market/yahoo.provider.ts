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

interface QuoteChart {
  meta?: Record<string, unknown>;
  quotes?: { date: Date | string; close?: number | null }[];
}

/**
 * Cotización a partir del gráfico diario. El gráfico no pide la credencial («crumb») que Yahoo exige para las
 * cotizaciones y que a veces niega a los servidores en la nube: es el plan B cuando esa consulta falla.
 */
export function quoteFromChart(symbol: string, chart: QuoteChart, now = new Date()) {
  const meta = chart.meta ?? {};
  const price = n(meta.regularMarketPrice);
  if (price == null) return null;
  const bars = (chart.quotes ?? []).filter((q) => n(q.close) != null && q.close! > 0);
  const at = meta.regularMarketTime instanceof Date ? meta.regularMarketTime.getTime()
    : n(meta.regularMarketTime) != null ? n(meta.regularMarketTime)! * 1000 : now.getTime();
  // La última barra es la sesión del precio actual: el cierre anterior es la barra de antes.
  const last = bars.at(-1);
  const sameSession = last && at - new Date(last.date).getTime() < 86_400_000;
  const previousClose = (sameSession ? bars.at(-2)?.close : last?.close) ?? null;
  return {
    symbol,
    name: s(meta.longName) ?? s(meta.shortName),
    currency: s(meta.currency),
    price,
    changePct: previousClose ? price / previousClose - 1 : null,
    previousClose,
    low52: n(meta.fiftyTwoWeekLow),
    high52: n(meta.fiftyTwoWeekHigh),
    quoteType: s(meta.instrumentType),
    exchange: s(meta.fullExchangeName) ?? s(meta.exchangeName),
    marketState: null,
    fetchedAt: now.toISOString(),
    source: 'Yahoo Finance',
  };
}

/** Cuánto vale una cotización sacada del gráfico (una consulta por valor: no se repite en cada refresco). */
const CHART_QUOTE_TTL_MS = 2 * 60_000;
/** Tras un fallo de la consulta de cotizaciones, cuánto se tarda en volver a probarla. */
const QUOTE_RETRY_MS = 10 * 60_000;

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
  private yf = new YahooFinance({ suppressNotices: ['yahooSurvey'],
    fetch: (input, init) => fetch(input, { ...init,
      signal: AbortSignal.any([AbortSignal.timeout(8_000), ...(init?.signal ? [init.signal] : [])]),
    }),
  });

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
    if (Date.now() < this.quoteBlockedUntil) return this.chartQuotes(symbols);
    let res: Record<string, unknown>[];
    try {
      res = (await this.yf.quote(symbols, { return: 'array' }, LOOSE)) as Record<string, unknown>[];
    } catch (err) {
      const quotes = await this.chartQuotes(symbols);
      if (!quotes.length) throw err;
      this.quoteBlockedUntil = Date.now() + QUOTE_RETRY_MS;
      console.warn(`[watchlist] Yahoo no da cotizaciones (${err instanceof Error ? err.message : err}): se usan las del gráfico`);
      return quotes;
    }
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
      source: 'Yahoo Finance',
    }));
  }

  private quoteBlockedUntil = 0;
  private chartCache = new Map<string, { value: NonNullable<ReturnType<typeof quoteFromChart>>; expires: number }>();

  /** Cotizaciones por la vía del gráfico, de cuatro en cuatro. Si no sale ninguna y hubo errores, falla. */
  private async chartQuotes(symbols: string[]) {
    const out: NonNullable<ReturnType<typeof quoteFromChart>>[] = [];
    const pending = [...symbols];
    let failure: unknown;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      for (let symbol = pending.shift(); symbol; symbol = pending.shift()) {
        const hit = this.chartCache.get(symbol);
        if (hit && hit.expires > Date.now()) { out.push(hit.value); continue; }
        try {
          const chart = (await this.yf.chart(symbol, { period1: new Date(Date.now() - 10 * 86_400_000), interval: '1d' }, LOOSE)) as QuoteChart;
          const value = quoteFromChart(symbol, chart);
          if (!value) continue;
          if (this.chartCache.size >= 1024) this.chartCache.delete(this.chartCache.keys().next().value!);
          this.chartCache.set(symbol, { value, expires: Date.now() + CHART_QUOTE_TTL_MS });
          out.push(value);
        } catch (err) { failure ??= err; }
      }
    }));
    if (!out.length && failure) throw failure;
    return out;
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
