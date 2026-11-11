import { describe, expect, it, vi } from 'vitest';
import { BorsaProvider, parseFundPage } from './borsa.provider.ts';

const page = `<h1>Polar Biotechnology R Dis Eur</h1>
<table><tr><td>Isin</td><td>IE00B3VXGD32</td></tr></table>
<table><tr><th>Ultima</th><th>Precedente</th><th>Valuta</th><th>Data</th><th>Variazione</th></tr>
<tr><td><span>65,50</span></td><td>65,35</td><td>EUR</td><td>10/11/25</td><td>+0,23</td></tr></table>`;
const url = 'https://www.borsaitaliana.it/borsa/fondi/dettaglio/2FADB302467.html?lang=it';

describe('NAV de Borsa Italiana', () => {
  it('lee el ISIN, la divisa y la fecha real, sin confundirla con la consulta', () => {
    expect(parseFundPage(page, 'IE00B3VXGD32', url)).toMatchObject({ name: 'Polar Biotechnology R Dis Eur',
      price: 65.5, previousClose: 65.35, currency: 'EUR', asOf: '2025-11-10', isin: 'IE00B3VXGD32', sourceUrl: url });
    expect(parseFundPage(page.replace('65,50', '1.065,50'), 'IE00B3VXGD32', url)?.price).toBe(1065.5);
  });
  it.each([
    page.replace('IE00B3VXGD32', 'IE00B3WVRB16'), page.replace('65,50', 'N.D.'),
    page.replace('65,50', '0'), page.replace('10/11/25', '31/02/25'),
    page.replace('10/11/25', '10/11/99'), page.replace('EUR', 'N.D.'), page.replace('Ultima', 'Otra tabla'),
  ])('rechaza otra clase o una ficha incompleta/malformada', html => {
    expect(parseFundPage(html, 'IE00B3VXGD32', url)).toBeNull();
  });
  it('no consulta símbolos sin cobertura y comparte las consultas simultáneas durante una hora', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(page));
    const provider = new BorsaProvider(fetcher);
    expect(await provider.getQuotes(['AAPL', 'EURUSD=X', '0P0001OJNQ.F'])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([provider.getQuotes(['IE00B3VXGD32']), provider.getQuotes(['IE00B3VXGD32'])]);
    expect(first).toEqual(second);
    expect(first[0]?.price).toBe(65.5);
    expect(await provider.getQuotes(['IE00B3VXGD32'])).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(url);
    expect(await provider.getHistory()).toEqual([]);
  });
  it('busca otros fondos por nombre y solo acepta identificadores propios de fondos', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ quotes: [
      { symbol: '2FADB12345', title: 'Fondo &amp; Clase EUR' },
      { symbol: '../../otra-ruta', title: 'Inválido' }, { symbol: 'AAPL', title: 'Acción' },
    ] })));
    const results = await new BorsaProvider(fetcher).search('Fondo Clase');
    expect(results).toEqual([{ symbol: 'BORSA:2FADB12345', name: 'Fondo & Clase EUR', exchange: 'Borsa Italiana / FIDA', type: 'MUTUALFUND' }]);
  });
});
