import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HoldingRow } from '@/shared';
import { HoldingInfo, holdingFinder } from './HoldingInfo.tsx';

const holding = (symbol: string, isin: string | null) =>
  ({
    ticker: symbol,
    instrument: { ticker: symbol, symbol, isin, name: null, sector: null, currency: 'USD', notes: null },
    currency: 'USD',
    fxRate: 1.1,
    valueEur: 1200,
    unrealizedEur: 200,
    unrealizedPct: 0.2,
    ledger: {
      shares: 10,
      costEur: 1000,
      sharesByBroker: { IBKR: 10 },
      openLots: [{ shares: 10, costEur: 1000, costNative: 1080 }],
    },
  }) as unknown as HoldingRow;

describe('holdingFinder', () => {
  const find = holdingFinder([holding('AAPL', 'US0378331005'), holding('TEF.MC', null)]);
  it('cruza por ISIN y, si no hay, por símbolo sin distinguir mayúsculas', () => {
    expect(find('OTRO', 'us0378331005')?.ticker).toBe('AAPL');
    expect(find('tef.mc', null)?.ticker).toBe('TEF.MC');
    expect(find('MSFT', null)).toBeUndefined();
  });
});

describe('HoldingInfo', () => {
  it('muestra acciones, precio medio al cambio de compra e importes', () => {
    const html = renderToStaticMarkup(createElement(HoldingInfo, { h: holding('AAPL', null) }));
    expect(html).toContain('En cartera');
    expect(html).toMatch(/108[,.]00/); // 1080 $ / 10 acciones
    expect(html).toContain('Precio medio');
    expect(html).toMatch(/1\.?200,00/);
  });
});
