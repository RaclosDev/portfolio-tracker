import type { InstrumentHit } from '@watchlist/shared';
import { isIsin } from './isin.ts';
import type { InstrumentCatalog } from './provider.ts';

/*
 * Buscador público de live.euronext.com (París, Ámsterdam, Milán, Bruselas, Lisboa, Dublín, Oslo). Encuentra por nombre
 * productos que onvista solo da por ISIN (p. ej. «swiss gold» → WisdomTree Physical Swiss Gold). Solo catálogo:
 * sus precios van cifrados, así que la bolsa y el precio salen de las demás fuentes.
 */
const URL = 'https://live.euronext.com/en/instrumentSearch/searchJSON?q=';
/** Sección de la ficha → tipo. Índices, opciones y futuros no se siguen. */
const TYPES: Readonly<Record<string, string>> = { equities: 'EQUITY', etfs: 'ETF', etvs: 'ETF', funds: 'MUTUALFUND' };
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

export function parseEuronextSearch(data: unknown): InstrumentHit[] {
  const hits = new Map<string, InstrumentHit>();
  for (const item of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) {
    const { isin, link, label } = item ?? {};
    if (typeof isin !== 'string' || typeof link !== 'string' || typeof label !== 'string' || !isIsin(isin)) continue;
    const type = TYPES[/\/product\/([a-z-]+)\//.exec(link)?.[1] ?? ''];
    const name = text(/<span class=['"]name['"]>([\s\S]*?)<\/span>/.exec(label)?.[1] ?? '');
    if (type && name && !hits.has(isin)) hits.set(isin, { isin, name, type });
  }
  return [...hits.values()];
}

export class EuronextCatalog implements InstrumentCatalog {
  constructor(private fetcher: typeof fetch = fetch) {}

  async findInstruments(query: string): Promise<InstrumentHit[]> {
    const q = query.trim();
    if (q.length < 3 || q.length > 100) return [];
    const res = await this.fetcher(`${URL}${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`Euronext HTTP ${res.status}`);
    return parseEuronextSearch(await res.json()).slice(0, 12);
  }
}
