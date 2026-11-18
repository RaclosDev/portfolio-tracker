import { describe, expect, it, vi } from 'vitest';
import { migrate, openPGlite } from '../../db/database.ts';
import {
  cleanHoldings, ExtraEtfComposition, FinancialHubComposition, FtComposition, isinInSymbol, OnvistaComposition, parseExtraEtf, parseFtHoldings,
  parseFinancialHub, parseOnvistaHoldings, parseYahooHoldings, tickerOf, YahooComposition, type CompositionSource,
} from './composition.ts';
import { MarketService } from './market.service.ts';
import type { MarketDataProvider } from './provider.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ftRow = (name: string, ticker: string, weight: string) =>
  `<tr><td class="mod-ui-table__cell--text"><a href="/data/equities/tearsheet/summary?s=${ticker}" class="mod-ui-link">${name}</a><br/>` +
  `<span class="mod-ui-table__cell__disclaimer">${ticker}</span></td><td><span class="mod-format--pos">+31.11%</span></td><td>${weight}</td>` +
  '<td class="mod-top-ten__holdings-row-allocation"><div style="width: 100%;"></div></td></tr>';
const ftPage = (...rows: string[]) =>
  '<h2>Top 10 holdings</h2><table><tbody><tr><td class="mod-ui-table__cell--colored">--</td><td>27.89%</td><td>0.00%</td><td>27.89%</td></tr></tbody></table>' +
  `<table class="mod-ui-table"><thead><th>Company</th><th>1 year change</th><th>Portfolio weight</th></thead>${rows.join('')}</table>` +
  '<div class="mod-disclaimer">As of Sep 30 2026.</div>';

describe('composición de fondos', () => {
  it('saca el ISIN de cualquier símbolo', () => {
    expect(isinInSymbol('XETRA:IE00B4L5Y983')).toBe('IE00B4L5Y983');
    expect(isinInSymbol('ft:ie00b03hcz61:eur')).toBe('IE00B03HCZ61');
    expect(isinInSymbol('IWDA.AS')).toBeNull();
  });

  it('descarta pesos imposibles y composiciones que suman más del 100 %', () => {
    const h = (name: string, weight: number, isin: string | null = null) => ({ name, isin, ticker: null, weight });
    expect(cleanHoldings([h('B', 0.1), h('A', 0.3), h('A', 0.3), h('C', 0), h('D', 1.5)], '2026-10-31')).toEqual({
      holdings: [h('A', 0.3), h('B', 0.1)], asOf: '2026-10-31',
    });
    expect(cleanHoldings([h('A', 0.7), h('B', 0.6)])).toBeNull();
    expect(cleanHoldings([])).toBeNull();
  });

  it('lee extraETF, onvista, FT y Yahoo', () => {
    expect(parseExtraEtf([{ name: 'Apple', isin: 'US0378331005', weight: 5.82 }, { name: 'Sin peso' }])).toEqual({
      holdings: [{ name: 'Apple', isin: 'US0378331005', ticker: null, weight: 0.0582 }], asOf: null,
    });
    expect(parseOnvistaHoldings({ fundsHoldingList: { dateMaintenance: '2026-10-30T12:00:00.000+00:00', list: [
      { instrument: { name: 'Nvidia', isin: 'US67066G1040' }, investmentPct: 5.71 },
    ] } })).toEqual({ holdings: [{ name: 'Nvidia', isin: 'US67066G1040', ticker: null, weight: 0.0571 }], asOf: '2026-10-30' });
    expect(parseOnvistaHoldings({ instrument: {} })).toBeNull();
    expect(parseFtHoldings(ftPage(ftRow('NVIDIA Corporation', 'NVDA:NSQ', '5.82%'), ftRow('Johnson &amp; Johnson', 'JNJ:NYQ', '1.10%')))).toEqual({
      holdings: [
        { name: 'NVIDIA Corporation', isin: null, ticker: 'NVDA:NSQ', weight: 0.0582 },
        { name: 'Johnson & Johnson', isin: null, ticker: 'JNJ:NYQ', weight: 0.011 },
      ],
      asOf: '2026-09-30',
    });
    expect(parseFtHoldings('<html>sin tabla</html>')).toBeNull();
    // Etiquetas anidadas para colar otra: no debe quedar ninguna en el nombre.
    expect(parseFtHoldings(ftPage(ftRow('Acme <scr<b>ipt>alert(1)</scr</b>ipt>', 'ACME:NYQ', '2.00%')))?.holdings[0]!.name).not.toMatch(/[<>]/);
    expect(parseYahooHoldings({ holdings: [{ symbol: 'NVDA', holdingName: 'NVIDIA Corp', holdingPercent: 0.2019 }] })).toEqual({
      holdings: [{ name: 'NVIDIA Corp', isin: null, ticker: 'NVDA', weight: 0.2019 }], asOf: null,
    });
  });

  it('lee la cartera completa de Financial Hub, sin liquidez ni divisas y sumando líneas repetidas', () => {
    const row = (name: string, weight: number | null, holdingType: string, isin: string | null = null) => ({ name, weight, holdingType, isin });
    expect(parseFinancialHub({ portfolioDate: '2026-11-12', data: [
      row('Advanced Micro Devices Inc', 10.48, 'E', 'US0079031078'),
      row('Taiwan Semiconductor Manufacturing Co Ltd', 8, 'E', 'TW0002330008'),
      row('Taiwan Semiconductor Manufacturing Co Ltd', 0.5, 'ER', 'TW0002330008'),
      row('USD - Spendable Cash', 0.88, 'C'),
      row('TWD/USD Purchased', 0.17, 'CU'),
      row('BlackRock ICS USD Liquidity Agency Inc', 0.13, 'FM', 'IE00B50QMP13'),
      row('US Treasury 4% 2030', 1.2, 'BT', 'US91282CJL54'),
      row('Sprott Physical Silver Trust', 4.26, 'FC', 'CA85207K1075'),
      row('Futuros Divisas Eur/Usd', 0.01, 'CL'),
      row('Sin peso', null, 'E'),
    ] })).toEqual({
      holdings: [
        { name: 'Advanced Micro Devices Inc', isin: 'US0079031078', ticker: null, weight: 0.1048 },
        { name: 'Taiwan Semiconductor Manufacturing Co Ltd', isin: 'TW0002330008', ticker: null, weight: 0.085 },
        { name: 'Sprott Physical Silver Trust', isin: 'CA85207K1075', ticker: null, weight: 0.0426 },
        { name: 'US Treasury 4% 2030', isin: 'US91282CJL54', ticker: null, weight: 0.012 },
      ],
      asOf: '2026-11-12',
    });
    // Pasa de las 25 que se guardan de las demás fuentes y junta las páginas.
    const many = (from: number) => Array.from({ length: 400 }, (_, i) => row(`Empresa ${from + i}`, 0.1, 'E'));
    expect(parseFinancialHub({ portfolioDate: '2026-11-12', data: many(0) }, { data: many(400) })?.holdings).toHaveLength(800);
    expect(parseFinancialHub({ data: [] })).toBeNull();
    expect(parseFinancialHub({ error: { code: 'NOT_FOUND' } })).toBeNull();
  });

  it('Financial Hub busca el fondo por el ISIN de cualquiera de sus clases y luego pide su cartera', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      urls.push(url.replace('https://api.financial-hub.es', ''));
      if (url.includes('/search')) {
        return json({ data: [
          { type: 'stock', id: '1', primary: { isin: 'LU0996182563' } },
          { type: 'fund', id: '200', primary: { isin: 'LU0996181599' }, matchedChild: { isin: 'LU0996182563' } },
        ] });
      }
      if (!url.includes('cursor=')) return json({ portfolioDate: '2026-11-10', nextCursor: 'a/b=', data: [{ name: 'Apple Inc', isin: 'US0378331005', holdingType: 'E', weight: 5.7 }] });
      return json({ portfolioDate: '2026-11-10', nextCursor: null, data: [{ name: 'Microsoft Corp', isin: 'US5949181045', holdingType: 'E', weight: 4.1 }] });
    });
    const fh = new FinancialHubComposition(fetcher);
    expect((await fh.getComposition({ isin: null, symbol: 'XETRA:LU0996182563' }))?.holdings.map((h) => h.name)).toEqual(['Apple Inc', 'Microsoft Corp']);
    expect(urls).toEqual([
      '/search?q=LU0996182563&identifierLookup=true&types=fund,etf',
      '/funds/200/portfolio/holdings?pageSize=500',
      '/funds/200/portfolio/holdings?pageSize=500&cursor=a%2Fb%3D',
    ]);
    expect(await fh.getComposition({ isin: null, symbol: 'IWDA.AS' })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4); // IWDA.AS se busca por ticker, pero ninguna cotización lo tiene
    const none = new FinancialHubComposition(vi.fn<typeof fetch>(async () => json({ data: [{ type: 'etf', id: '9', primary: { isin: 'IE00B4L5Y983' } }] })));
    expect(await none.getComposition({ isin: 'IE00B3XXRP09', symbol: null })).toBeNull();
    await expect(new FinancialHubComposition(vi.fn<typeof fetch>(async () => json({}, 429))).getComposition({ isin: 'IE00B4L5Y983', symbol: null })).rejects.toThrow(/429/);
  });

  it('sin ISIN, Financial Hub busca por ticker y elige la cotización de su bolsa y divisa', async () => {
    expect(tickerOf('FT:SEC0:GER:EUR')).toEqual({ root: 'SEC0', mic: 'XETR', currency: 'EUR' });
    expect(tickerOf('semi.as')).toEqual({ root: 'SEMI', mic: 'XAMS', currency: null });
    expect(tickerOf('VOO')).toEqual({ root: 'VOO', mic: null, currency: null });
    const urls: string[] = [];
    const listing = (id: string, symbol: string, exchange: string, currency: string) =>
      ({ type: 'etf', id, primary: { isin: `IE${id}` }, matchedChild: { symbol, exchange, currency } });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input).replace('https://api.financial-hub.es', '');
      urls.push(url);
      if (url.includes('/search?q=SEC0')) return json({ data: [listing('12746', 'SEC0', 'XETR', 'EUR'), listing('5', 'SEC0X', 'XETR', 'EUR')] });
      if (url.includes('/search?q=SEMI')) {
        return json({ data: [listing('12746', 'SEMI', 'XAMS', 'USD'), listing('13199', 'SEMI', 'XASE', 'USD'), listing('12819', 'SEMI', 'XASX', 'AUD')] });
      }
      return json({ portfolioDate: '2026-10-31', nextCursor: null, data: [{ name: 'NVIDIA Corp', isin: 'US67066G1040', holdingType: 'E', weight: 20 }] });
    });
    const fh = new FinancialHubComposition(fetcher);
    expect((await fh.getComposition({ isin: null, symbol: 'FT:SEC0:GER:EUR' }))?.holdings[0]?.name).toBe('NVIDIA Corp');
    expect(urls).toEqual(['/search?q=SEC0&identifierLookup=true&types=fund,etf', '/funds/12746/portfolio/holdings?pageSize=500']);
    expect(await fh.getComposition({ isin: null, symbol: 'SEMI.AS' })).not.toBeNull();
    expect(urls.at(-1)).toBe('/funds/12746/portfolio/holdings?pageSize=500');
    // Sin bolsa, el mismo ticker es de tres fondos distintos: mejor nada que el que no es.
    expect(await fh.getComposition({ isin: null, symbol: 'SEMI' })).toBeNull();
  });

  it('cada fuente pide solo lo que puede resolver', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json([{ name: 'Apple', isin: 'US0378331005', weight: 5 }]));
    expect(await new ExtraEtfComposition(fetcher).getComposition({ isin: null, symbol: 'IWDA.AS' })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await new ExtraEtfComposition(fetcher).getComposition({ isin: 'IE00B4L5Y983', symbol: null }))?.holdings).toHaveLength(1);
    expect(String(fetcher.mock.calls[0]![0])).toContain('isin=IE00B4L5Y983');
    expect(await new OnvistaComposition(vi.fn<typeof fetch>(async () => json({}, 404))).getComposition({ isin: 'ES0119199000', symbol: null })).toBeNull();
    await expect(new OnvistaComposition(vi.fn<typeof fetch>(async () => json({}, 503))).getComposition({ isin: 'ES0119199000', symbol: null })).rejects.toThrow(/503/);
    const top = vi.fn(async () => ({ holdings: [{ holdingName: 'NVIDIA Corp', holdingPercent: 0.2 }] }));
    expect(await new YahooComposition(top).getComposition({ isin: null, symbol: 'XETRA:IE00B4L5Y983' })).toBeNull();
    expect((await new YahooComposition(top).getComposition({ isin: null, symbol: 'SMH' }))?.holdings[0]!.name).toBe('NVIDIA Corp');
    expect(top).toHaveBeenCalledTimes(1);
  });

  it('FT prueba la ficha de fondo y, si no hay, busca el símbolo del ETF', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('searchsecurities')) return json({ data: { security: [{ symbol: 'ACME:LSE:GBX', assetClass: 'Equities' }, { symbol: 'SWDA:LSE:GBX', assetClass: 'ETFs' }] } });
      return new Response(url.includes('/etfs/') ? ftPage(ftRow('Apple Inc.', 'AAPL:NSQ', '5.82%')) : '<html></html>');
    });
    const found = await new FtComposition(fetcher).getComposition({ isin: 'IE00B4L5Y983', symbol: 'XETRA:IE00B4L5Y983' });
    expect(found?.holdings[0]).toMatchObject({ name: 'Apple Inc.', weight: 0.0582 });
    expect(urls.map((u) => u.split('/data/')[1])).toEqual([
      'funds/tearsheet/holdings?s=IE00B4L5Y983%3AEUR', 'searchapi/searchsecurities?query=IE00B4L5Y983', 'etfs/tearsheet/holdings?s=SWDA%3ALSE%3AGBX',
    ]);
  });

  it('FT encuentra sin ISIN el fondo por su código de Morningstar y el ETF por su ticker y su bolsa', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      urls.push(url.split('/data/')[1]!);
      if (url.includes('query=0P00016YQ5')) return json({ data: { security: [{ symbol: 'ES0112611001:EUR', assetClass: 'Funds' }, { symbol: 'ES0114764030:EUR', assetClass: 'Funds' }] } });
      if (url.includes('query=VUSA')) return json({ data: { security: [{ symbol: 'VUSA:LSE:GBP', assetClass: 'ETFs' }, { symbol: 'VUSAX:AEX:EUR', assetClass: 'ETFs' }, { symbol: 'VUSA:AEX:EUR', assetClass: 'ETFs' }] } });
      if (url.includes('searchsecurities')) return json({ data: { security: [{ symbol: 'SAN:MCE', assetClass: 'Equities' }] } });
      return new Response(ftPage(ftRow('Barrick Mining Corporation', 'ABX:TOR', '6.39%')));
    });
    const ft = new FtComposition(fetcher);
    expect((await ft.getComposition({ isin: null, symbol: '0P00016YQ5.F' }))?.holdings[0]).toMatchObject({ name: 'Barrick Mining Corporation', weight: 0.0639 });
    expect(await ft.getComposition({ isin: null, symbol: 'VUSA.AS' })).not.toBeNull();
    expect(await ft.getComposition({ isin: null, symbol: 'SAN.MC' })).toBeNull();
    expect(await ft.getComposition({ isin: null, symbol: 'XETRA:SIN-ISIN' })).toBeNull();
    expect(urls).toEqual([
      'searchapi/searchsecurities?query=0P00016YQ5', 'funds/tearsheet/holdings?s=ES0112611001%3AEUR',
      'searchapi/searchsecurities?query=VUSA', 'etfs/tearsheet/holdings?s=VUSA%3AAEX%3AEUR',
      'searchapi/searchsecurities?query=SAN',
    ]);
  });
});

// Cada caso abre su propia base PGlite: con toda la batería en paralelo tarda más que el límite por defecto.
describe('composición en el servicio de mercado', { timeout: 30_000 }, () => {
  const holdings = [{ name: 'Apple', isin: 'US0378331005', ticker: null, weight: 0.05 }];
  const service = async (sources: CompositionSource[]) => {
    const db = openPGlite();
    await migrate(db);
    return new MarketService({ id: 'prueba' } as MarketDataProvider, db, { quoteTtlMs: 0, targetsTtlMs: 0 }, () => {}, undefined, sources);
  };
  const ref = { isin: 'IE00B4L5Y983', symbol: 'IWDA.AS' };

  it('pasa a la siguiente fuente si una falla o no lo tiene, y guarda el resultado', async () => {
    const broken = { id: 'rota', getComposition: vi.fn(async () => { throw new Error('HTTP 503'); }) };
    const empty = { id: 'vacía', getComposition: vi.fn(async () => null) };
    const good = { id: 'buena', getComposition: vi.fn(async () => ({ holdings, asOf: '2026-10-31' })) };
    const market = await service([broken, empty, good]);
    expect(await market.getComposition(ref)).toMatchObject({ holdings, asOf: '2026-10-31', source: 'buena' });
    await market.getComposition(ref);
    expect(good.getComposition).toHaveBeenCalledTimes(1);
    expect(broken.getComposition).toHaveBeenCalledTimes(1);
  });

  it('recuerda que no existe solo si ninguna fuente ha fallado', async () => {
    const empty = { id: 'vacía', getComposition: vi.fn(async () => null) };
    const market = await service([empty]);
    expect(await market.getComposition(ref)).toBeNull();
    await market.getComposition(ref);
    expect(empty.getComposition).toHaveBeenCalledTimes(1);

    const broken = { id: 'rota', getComposition: vi.fn(async () => { throw new Error('timeout'); }) };
    const retry = await service([broken]);
    expect(await retry.getComposition(ref)).toBeNull();
    await retry.getComposition(ref);
    expect(broken.getComposition).toHaveBeenCalledTimes(2);
    expect(await (await service([])).getComposition(ref)).toBeNull();
  });
});
