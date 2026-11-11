import type { HistoryRange, PricePoint, Quote, SymbolSearchResult } from '@watchlist/shared';
import { isIsin } from './isin.ts';
import type { MarketDataProvider } from './provider.ts';

const ORIGIN = 'https://www1.quefondos.com';
const SOURCE = 'Quefondos / VDOS';
// Clases comprobadas por ISIN en Yahoo y en la ficha del fondo; no se deducen del nombre.
const YAHOO_ISINS: Readonly<Record<string, string>> = {
  '0P00016YQ5.F': 'ES0112611001',
  '0P0001F2GG.F': 'ES0112602000',
  '0P00019OVT.F': 'IE00BDGV0290',
  '0P0001OJNQ.F': 'LU2441282899',
};
const isinFor = (symbol: string) => YAHOO_ISINS[symbol] ?? (isIsin(symbol) ? symbol : null);
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
const decimal = (value: string) => /^[+-]?\d+(?:\.\d{3})*(?:,\d+)?$/.test(value)
  ? Number(value.replace(/\./g, '').replace(',', '.')) : NaN;
const date = (value: string, us = false) => {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!parts) return null;
  const iso = `${parts[3]}-${parts[us ? 1 : 2]}-${parts[us ? 2 : 1]}`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso
    && iso <= new Date().toISOString().slice(0, 10) ? iso : null;
};

interface FundPage { quote: Omit<Quote, 'stale'>; monthly: PricePoint[] | null }

export function parseQuefondosPage(html: string, isin: string, url: string): FundPage | null {
  const fields = new Map<string, string>();
  for (const paragraph of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const pair = /<span\b[^>]*class="floatleft"[^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*class="floatright"[^>]*>([\s\S]*)<\/span>/i.exec(paragraph[1]!);
    if (pair) fields.set(text(pair[1]!), text(pair[2]!));
  }
  if (!isIsin(isin) || fields.get('ISIN:') !== isin) return null;
  const nav = /^([\d.,]+) ([A-Z]{3})$/.exec(fields.get('Valor liquidativo:') ?? '');
  const price = decimal(nav?.[1] ?? '');
  const currency = nav?.[2];
  const asOf = date(fields.get('Fecha:') ?? '');
  const nameLiteral = /\bvar\s+label_fondo\s*=\s*("(?:\\.|[^"\\])*")\s*;/.exec(html)?.[1];
  let name: unknown;
  try { name = nameLiteral ? JSON.parse(nameLiteral) : null; } catch { return null; }
  if (!Number.isFinite(price) || price <= 0 || !currency || fields.get('Divisa:') !== currency
    || !asOf || typeof name !== 'string' || !name.trim()) return null;
  const change = decimal((fields.get('1 d&iacute;a:') ?? fields.get('1 día:') ?? '').replace(/%$/, ''));
  const quote: Omit<Quote, 'stale'> = { symbol: isin, name: text(name), currency, price,
    previousClose: null, changePct: Number.isFinite(change) ? change / 100 : null,
    low52: null, high52: null, quoteType: 'MUTUALFUND', exchange: SOURCE, marketState: null,
    source: SOURCE, sourceUrl: url, asOf, isin, fetchedAt: new Date().toISOString() };
  let monthly: PricePoint[] | null = null;
  const series = /\bvar\s+fondo\s*=\s*(\[[\s\S]*?\])\s*;/.exec(html)?.[1];
  try {
    const raw: unknown = series ? JSON.parse(series) : null;
    if (Array.isArray(raw)) {
      const points = new Map<string, number>();
      for (const item of raw as unknown[]) {
        if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string'
          || typeof item[1] !== 'number' || !Number.isFinite(item[1]) || item[1] <= 0) throw new Error('NAV mensual inválido');
        const t = date(item[0], true);
        if (!t) throw new Error('Fecha mensual inválida');
        // Algunas fichas etiquetan el último punto con una fecha posterior a la valoración.
        // Prevalece la fecha del NAV; ese punto no se utiliza.
        if (t > asOf) continue;
        points.set(t, item[1]);
      }
      // La última observación también es real; no se rellenan los días intermedios.
      points.set(asOf, price);
      monthly = [...points].sort(([a], [b]) => a.localeCompare(b)).map(([t, c]) => ({ t, c }));
    }
  } catch { /* Una serie malformada no invalida el NAV comprobado de la ficha. */ }
  return { quote, monthly };
}

/** NAV y observaciones mensuales por ISIN. No ofrece cierres diarios para valorar una cartera. */
export class QuefondosProvider implements MarketDataProvider {
  readonly id = 'quefondos';
  private cache = new Map<string, { value: FundPage | null; expires: number }>();
  private pending = new Map<string, Promise<FundPage | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  constructor(private fetcher: typeof fetch = fetch) {}

  private async fund(symbol: string): Promise<FundPage | null> {
    const isin = isinFor(symbol);
    if (!isin) return null;
    const cached = this.cache.get(isin);
    if (cached && cached.expires > Date.now()) return cached.value;
    const pending = this.pending.get(isin);
    if (pending) return pending;
    const request = this.queue.then(async () => {
      const delay = 500 - (Date.now() - this.lastRequest);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastRequest = Date.now();
      const url = `${ORIGIN}/es/fondos/ficha/index.html?isin=${isin}`;
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000), redirect: 'error' });
      if (!response.ok && response.status !== 404) throw new Error(`Quefondos HTTP ${response.status}`);
      const value = response.status === 404 ? null : parseQuefondosPage(await response.text(), isin, url);
      if (response.ok && !value) throw new Error(`Ficha de Quefondos inválida: ${isin}`);
      if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(isin, { value, expires: Date.now() + 60 * 60_000 });
      return value;
    });
    this.queue = request.catch(() => {});
    this.pending.set(isin, request);
    try { return await request; } finally { this.pending.delete(isin); }
  }

  async getQuotes(symbols: string[]) {
    const results: Omit<Quote, 'stale'>[] = [];
    let failure: unknown;
    for (const input of symbols) {
      const symbol = input.toUpperCase();
      try { const data = await this.fund(symbol); if (data) results.push({ ...data.quote, symbol }); }
      catch (error) { failure = error; if (/\b429\b/.test(String(error))) break; }
    }
    if (failure && !results.length) throw failure;
    return results;
  }

  async search(query: string): Promise<SymbolSearchResult[]> {
    const input = query.trim().toUpperCase();
    const data = await this.fund(input);
    if (!data) return [];
    const symbol = Object.keys(YAHOO_ISINS).find(key => YAHOO_ISINS[key] === data.quote.isin) ?? input;
    return [{ symbol, name: `${data.quote.name} · ${data.quote.isin}`, exchange: SOURCE, type: 'MUTUALFUND' }];
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
    const data = await this.fund(symbol.toUpperCase());
    if (!data) return [];
    if (!data.monthly) throw new Error('Histórico mensual de Quefondos inválido');
    const from = new Date();
    from.setUTCMonth(from.getUTCMonth() - ({ '1m': 1, '3m': 3, '6m': 6, '1y': 12, '5y': 60 }[range]));
    const cutoff = from.toISOString().slice(0, 10);
    return data.monthly.filter(point => point.t >= cutoff);
  }

  async getTargets() { return null; }
}
