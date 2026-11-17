import { describe, expect, it, vi } from 'vitest';
import { migrate, openPGlite } from '../../db/database.ts';
import {
  cleanHoldings, ExtraEtfComposition, FtComposition, isinInSymbol, OnvistaComposition, parseExtraEtf, parseFtHoldings,
  parseOnvistaHoldings, parseYahooHoldings, YahooComposition, type CompositionSource,
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
