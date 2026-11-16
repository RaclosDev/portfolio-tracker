import { describe, expect, it, vi } from 'vitest';
import { OnvistaProvider, parseOnvistaSymbol, toQuote } from './onvista.provider.ts';

const ISIN = 'JE00B588CD74';
const instrument = {
  entityType: 'DERIVATIVE', entitySubType: 'ETC_ETN_CERTIFICATE', entityValue: '26777520',
  name: 'WisdomTree Physical Swiss Gold', isin: ISIN,
  urls: { WEBSITE: 'https://www.onvista.de/derivate/ETCs/26777520-A1DCTK-JE00B588CD74' },
};
const xetra = { market: { name: 'Xetra', codeExchange: 'GER' }, isoCurrency: 'EUR', last: 336.3, previousLast: 336.36,
  datetimeLast: '2026-11-16T15:09:54.210+00:00', lowPrice1Year: 280, highPrice1Year: 443.64 };
const lsx = { market: { name: 'LS Exchange', codeExchange: 'LSX' }, isoCurrency: 'EUR', last: 335.36, previousLast: 335.4,
  datetimeLast: '2026-11-16T15:26:17.587+00:00', lowPrice1Year: 169.31, highPrice1Year: 300 };
const snapshot = { instrument, quote: lsx, quoteList: { list: [xetra, lsx] } };

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const fakeApi = () => vi.fn<typeof fetch>(async (input) => {
  const url = String(input);
  if (url.includes('/instruments/query')) return json({ list: [instrument] });
  if (url.endsWith('/instruments/DERIVATIVE/26777520/snapshot')) return json(snapshot);
  return new Response('', { status: 404 });
});

describe('cotizaciones de onvista', () => {
  it('reconoce símbolos con bolsa o ISIN solo, y deja los de Yahoo', () => {
    expect(parseOnvistaSymbol('xetra:je00b588cd74')).toEqual({ venue: 'XETRA', isin: ISIN });
    expect(parseOnvistaSymbol(ISIN)).toEqual({ venue: null, isin: ISIN });
    for (const s of ['GZUR.DE', 'SGBS.MI', 'BORSA:2FADB302467', 'NASDAQ:JE00B588CD74']) expect(parseOnvistaSymbol(s)).toBeNull();
  });

  it('toma el precio de la bolsa pedida y descarta un rango anual incoherente', () => {
    expect(toQuote(snapshot, `XETRA:${ISIN}`)).toMatchObject({
      name: 'WisdomTree Physical Swiss Gold', price: 336.3, previousClose: 336.36, currency: 'EUR', exchange: 'Xetra',
      quoteType: 'ETF', asOf: '2026-11-16', isin: ISIN, low52: 280, high52: 443.64, source: 'onvista',
    });
    expect(toQuote(snapshot, ISIN)).toMatchObject({ price: 335.36, exchange: 'LS Exchange', low52: null, high52: null });
  });

  it.each([
    [`TRADEGATE:${ISIN}`, snapshot], // no cotiza en esa bolsa
    [`XETRA:${ISIN}`, { ...snapshot, instrument: { ...instrument, isin: 'IE00B3VXGD32' } }], // otro valor
    [`XETRA:${ISIN}`, { ...snapshot, quoteList: { list: [{ ...xetra, last: 0 }] } }],
    [`XETRA:${ISIN}`, { ...snapshot, quoteList: { list: [{ ...xetra, isoCurrency: undefined }] } }],
  ])('sin precio válido no devuelve nada (%s)', (symbol, snap) => {
    expect(toQuote(snap, symbol)).toBeNull();
  });

  it('no consulta símbolos ajenos y reutiliza instrumento y cotización en caché', async () => {
    const fetcher = fakeApi();
    const provider = new OnvistaProvider(fetcher);
    expect(await provider.getQuotes(['GZUR.DE', 'BORSA:2FADB302467'])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([provider.getQuotes([`XETRA:${ISIN}`]), provider.getQuotes([`xetra:${ISIN}`])]);
    expect(a[0]?.price).toBe(336.3);
    expect(b[0]?.symbol).toBe(`XETRA:${ISIN}`);
    await provider.getQuotes([ISIN]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('la búsqueda ofrece las bolsas alemanas donde cotiza', async () => {
    const provider = new OnvistaProvider(fakeApi());
    expect(await provider.search('wisdomtree swiss gold')).toEqual([
      { symbol: `XETRA:${ISIN}`, name: `WisdomTree Physical Swiss Gold · ${ISIN}`, exchange: 'Xetra (onvista)', type: 'ETF' },
      { symbol: `LSX:${ISIN}`, name: `WisdomTree Physical Swiss Gold · ${ISIN}`, exchange: 'LS Exchange (onvista)', type: 'ETF' },
    ]);
    expect(await provider.search('go')).toEqual([]);
  });

  it('si onvista falla y no hay nada, lanza el error para que el respaldo lo pause', async () => {
    const provider = new OnvistaProvider(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })));
    await expect(provider.getQuotes([`XETRA:${ISIN}`])).rejects.toThrow('503');
  });
});
