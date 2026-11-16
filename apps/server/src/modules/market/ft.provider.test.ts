import { describe, expect, it, vi } from 'vitest';
import { FtProvider, parseFtSymbol } from './ft.provider.ts';
import { EuronextCatalog } from './euronext.catalog.ts';
import { mergeCatalogs } from './provider.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const security = { symbol: 'GZUR:GER:EUR', name: 'WisdomTree Physical Swiss Gold', xid: '22573342', assetClass: 'ETFs' };
const series = {
  Dates: ['2026-11-12T00:00:00', '2026-11-13T00:00:00', '2026-11-16T00:00:00'],
  Elements: [{ CompanyName: 'WisdomTree Physical Swiss Gold', ExchangeId: 'GER', Currency: 'EUR',
    ComponentSeries: [{ Type: 'Open', Values: [1, 2, 3] }, { Type: 'Close', Values: [334, null, 334.84] }] }],
};
const fakeFt = () => vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input);
  if (url.includes('/searchapi/searchsecurities')) return json({ data: { security: [security, { ...security, symbol: 'BUGCDF:IOM', assetClass: 'Indices' }] } });
  if (url.endsWith('/chartapi/series') && JSON.parse(String(init?.body)).elements[0].Symbol === '22573342') return json(series);
  return new Response('', { status: 404 });
});

describe('FT Markets', () => {
  it('solo reconoce símbolos con prefijo FT:', () => {
    expect(parseFtSymbol('ft:gzur:ger:eur')).toBe('GZUR:GER:EUR');
    for (const s of ['GZUR.DE', 'XETRA:JE00B588CD74', 'FT:']) expect(parseFtSymbol(s)).toBeNull();
  });

  it('busca por nombre sin índices y no atiende símbolos de otras fuentes', async () => {
    const fetcher = fakeFt();
    const ft = new FtProvider(fetcher);
    expect(await ft.search('swiss gold')).toEqual([
      { symbol: 'FT:GZUR:GER:EUR', name: 'WisdomTree Physical Swiss Gold', exchange: 'Xetra (FT)', type: 'ETF' },
    ]);
    expect(await ft.search('XETRA:JE00B588CD74')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cotiza con el último cierre válido y da el histórico', async () => {
    const ft = new FtProvider(fakeFt());
    expect(await ft.getQuotes(['FT:GZUR:GER:EUR', 'ITX.MC'])).toMatchObject([{
      symbol: 'FT:GZUR:GER:EUR', price: 334.84, previousClose: 334, currency: 'EUR', quoteType: 'ETF',
      exchange: 'Xetra (FT)', asOf: '2026-11-16', low52: 334, high52: 334.84,
    }]);
    expect(await ft.getDailyHistory('FT:GZUR:GER:EUR', '2026-11-13')).toEqual({ currency: 'EUR', points: [{ t: '2026-11-16', c: 334.84 }] });
    expect(await ft.getQuotes(['FT:NOEXISTE:XXX'])).toEqual([]);
  });
});

describe('catálogo de Euronext', () => {
  const label = (name: string) => `<span class='name'><a href='/x'>${name}</a></span><span class='symbol'>SGBS</span>`;
  const results = [
    { isin: 'JE00B588CD74', link: '/en/product/etvs/JE00B588CD74-ETFP', label: label('WISDOMTREE PHYSICAL SWISS GOLD') },
    { isin: 'JE00B588CD74', link: '/en/product/etvs/JE00B588CD74-XAMS', label: label('Wisdom Tree PHYSICAL SWISS GOLD') },
    { isin: 'NL0010273215', link: '/en/product/stock-options/ASL-DAMS', label: label('ASML Holding NV') },
    { isin: '', link: '/en/search_instruments/swiss-gold', label: 'See all results' },
  ];

  it('da un producto por ISIN y descarta opciones y el enlace final', async () => {
    const catalog = new EuronextCatalog(vi.fn<typeof fetch>(async () => json(results)));
    expect(await catalog.findInstruments('swiss gold')).toEqual([{ isin: 'JE00B588CD74', name: 'WISDOMTREE PHYSICAL SWISS GOLD', type: 'ETF' }]);
  });

  it('junta catálogos intercalados aunque uno falle', async () => {
    const hit = (isin: string) => ({ isin, name: isin, type: 'ETF' });
    const merged = mergeCatalogs([
      { findInstruments: async () => [hit('A'), hit('B')] },
      { findInstruments: async () => { throw new Error('caído'); } },
      { findInstruments: async () => [hit('C')] },
    ]);
    expect((await merged.findInstruments('x')).map((h) => h.isin)).toEqual(['A', 'C', 'B']);
  });
});
