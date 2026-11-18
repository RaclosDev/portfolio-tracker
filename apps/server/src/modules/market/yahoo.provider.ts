import type { DailyHistory, HistoryRange, PricePoint } from '@watchlist/shared';
import YahooFinance from 'yahoo-finance2';
import { errorSummary, type MarketDataProvider } from './provider.ts';

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
    fallback: true,
  };
}

/** Cuánto vale una cotización sacada del gráfico (una consulta por valor: no se repite en cada refresco). */
const CHART_QUOTE_TTL_MS = 2 * 60_000;
/**
 * Tras un fallo de la credencial, cuánto se tarda en volver a pedirla. Se duplica en cada fallo seguido: insistir
 * cada pocos minutos alarga el bloqueo de Yahoo.
 */
const CRUMB_RETRY_MS = 10 * 60_000;
const CRUMB_RETRY_MAX_MS = 60 * 60_000;
/**
 * Yahoo solo da la credencial a una lista de identificaciones de cliente admitidas (a las demás responde 429). La de
 * la librería («yahoo-finance2/x») entra en esa lista desde unas redes y no desde otras: se envía siempre la de un navegador.
 */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

type YahooClient = InstanceType<typeof YahooFinance>;

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
  private yf: YahooClient;
  constructor(client?: YahooClient) {
    this.yf = client ?? new YahooFinance({ suppressNotices: ['yahooSurvey'],
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('User-Agent', BROWSER_UA);
        return fetch(input, { ...init, headers,
          signal: AbortSignal.any([AbortSignal.timeout(8_000), ...(init?.signal ? [init.signal] : [])]),
        });
      },
    });
  }

  /**
   * Consultas que piden la credencial («crumb») de Yahoo: consenso, ficha y composición. Si Yahoo la niega no se
   * insiste hasta el siguiente reintento, y el error que sale no pausa la fuente: el gráfico y el buscador no la
   * necesitan y siguen funcionando.
   */
  private async withCrumb<T>(run: () => Promise<T>): Promise<T> {
    if (Date.now() < this.quoteBlockedUntil) throw new Error('Yahoo no da la credencial de sus consultas (crumb)');
    try {
      const result = await run();
      this.crumbRetryMs = CRUMB_RETRY_MS;
      return result;
    } catch (err) {
      if (!/crumb/i.test(String(err))) throw err;
      this.blockCrumb(err);
      throw new Error('Yahoo no da la credencial de sus consultas (crumb)', { cause: err });
    }
  }

  private blockCrumb(err: unknown) {
    this.quoteError = { at: new Date().toISOString(), message: errorSummary(err) };
    this.quoteBlockedUntil = Date.now() + this.crumbRetryMs;
    this.crumbRetryMs = Math.min(this.crumbRetryMs * 2, CRUMB_RETRY_MAX_MS);
  }

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

  /** Mayores posiciones de un fondo o ETF (módulo topHoldings), tal como las da Yahoo. */
  async topHoldings(symbol: string): Promise<unknown> {
    try {
      const res = (await this.withCrumb(() => this.yf.quoteSummary(symbol, { modules: ['topHoldings'] }, LOOSE))) as { topHoldings?: unknown };
      return res.topHoldings ?? null;
    } catch (error) {
      // Una acción o un símbolo que Yahoo no conoce: no tiene composición, no es un fallo de la fuente.
      if (/no fundamentals data|not found|404/i.test(String(error))) return null;
      throw error;
    }
  }

  async getProfile(symbol: string) {
    const res = (await this.withCrumb(() => this.yf.quoteSummary(symbol, { modules: ['assetProfile', 'price'] }, LOOSE))) as {
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
      this.crumbRetryMs = CRUMB_RETRY_MS;
    } catch (err) {
      this.quoteError = { at: new Date().toISOString(), message: errorSummary(err) };
      const quotes = await this.chartQuotes(symbols);
      // Sin credencial y sin nada en el gráfico (símbolos que Yahoo no conoce): no es motivo para pausar la fuente.
      if (!quotes.length && !/crumb/i.test(String(err))) throw err;
      this.blockCrumb(err);
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
  private crumbRetryMs = CRUMB_RETRY_MS;
  private quoteError: { at: string; message: string } | null = null;
  private chartError: { at: string; message: string } | null = null;

  diagnostics() {
    return {
      quotesByChartUntil: this.quoteBlockedUntil > Date.now() ? new Date(this.quoteBlockedUntil).toISOString() : null,
      quoteError: this.quoteError,
      chartError: this.chartError,
    };
  }
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
        } catch (err) {
          failure ??= err;
          this.chartError = { at: new Date().toISOString(), message: errorSummary(err) };
        }
      }
    }));
    if (!out.length && failure) throw failure;
    return out;
  }

  async getTargets(symbol: string) {
    const res = (await this.withCrumb(() => this.yf.quoteSummary(
      symbol,
      { modules: ['financialData', 'calendarEvents', 'summaryDetail'] },
      LOOSE,
    ))) as {
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
