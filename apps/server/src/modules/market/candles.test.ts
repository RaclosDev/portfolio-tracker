import { describe, expect, it } from 'vitest';
import { liveCandle } from './financialhub.provider.ts';
import { candlesFromChart } from './yahoo.provider.ts';

describe('vela de hoy de Financial Hub', () => {
  it('sale de la cotización con apertura, máximo y mínimo del día', () => {
    expect(liveCandle({ price: 10.4, currency: 'EUR', tradingDate: '2026-11-19', day: { open: 10, high: 10.6, low: 9.9 } }, 'EUR'))
      .toEqual({ t: '2026-11-19', o: 10, h: 10.6, l: 9.9, c: 10.4 });
  });

  it('el máximo y el mínimo siempre abarcan apertura y cierre', () => {
    expect(liveCandle({ price: 11, currency: 'EUR', tradingDate: '2026-11-19', day: { open: 10, high: null, low: null } }, 'EUR'))
      .toEqual({ t: '2026-11-19', o: 10, h: 11, l: 10, c: 11 });
  });

  it('sin apertura, con fecha rara o en otra divisa no hay vela', () => {
    expect(liveCandle({ price: 10, currency: 'EUR', tradingDate: '2026-11-19', day: null }, 'EUR')).toBeNull();
    expect(liveCandle({ price: 10, currency: 'EUR', tradingDate: 'hoy', day: { open: 10 } }, 'EUR')).toBeNull();
    expect(liveCandle({ price: 10, currency: 'USD', tradingDate: '2026-11-19', day: { open: 10 } }, 'EUR')).toBeNull();
  });
});

describe('velas de Yahoo', () => {
  it('una por sesión en la hora de la bolsa, ordenadas y sin cierres vacíos', () => {
    const candles = candlesFromChart({
      meta: { exchangeTimezoneName: 'America/New_York' },
      quotes: [
        { date: '2026-11-18T14:30:00Z', open: 100, high: 105, low: 99, close: 104 },
        { date: '2026-11-17T14:30:00Z', open: 98, high: 101, low: 97, close: 100 },
        { date: '2026-11-19T02:00:00Z', open: 1, high: 1, low: 1, close: null },
        { date: '2026-11-19T14:30:00Z', open: null, high: null, low: null, close: 103 },
      ],
    });
    expect(candles).toEqual([
      { t: '2026-11-17', o: 98, h: 101, l: 97, c: 100 },
      { t: '2026-11-18', o: 100, h: 105, l: 99, c: 104 },
      { t: '2026-11-19', o: 103, h: 103, l: 103, c: 103 },
    ]);
  });
});
