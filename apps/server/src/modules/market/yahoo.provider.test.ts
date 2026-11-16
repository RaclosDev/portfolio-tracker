import { describe, expect, it } from 'vitest';
import { dailyHistoryFromChart, quoteFromChart } from './yahoo.provider.ts';

describe('cierres para acciones históricas', () => {
  it('deshace splits posteriores al cierre sin aplicar dividendos ni duplicar el split de ese día', () => {
    const result = dailyHistoryFromChart({ meta: { currency: 'USD' }, quotes: [
      { date: '2020-08-28', close: 25 }, { date: '2020-08-31', close: 26 },
      { date: '2022-01-01', close: 30 }, { date: '2022-01-02', close: null },
    ], events: { splits: [
      { date: '2020-08-31', numerator: 4, denominator: 1 },
      { date: '2022-01-01', numerator: 2, denominator: 1 },
    ] } });
    expect(result).toEqual({ currency: 'USD', points: [
      { t: '2020-08-28', c: 200 }, { t: '2020-08-31', c: 52 }, { t: '2022-01-01', c: 30 },
    ] });
  });
  it('conserva contrasplits y descarta cierres no finitos', () => {
    expect(dailyHistoryFromChart({ quotes: [{ date: '2026-01-01', close: 50 }, { date: '2026-01-02', close: NaN }],
      events: { splits: [{ date: '2026-01-03', numerator: 1, denominator: 10 }] } }).points).toEqual([{ t: '2026-01-01', c: 5 }]);
  });
  it('asigna el cierre al día de la bolsa, también cuando en UTC todavía es la víspera', () => {
    expect(dailyHistoryFromChart({ meta: { exchangeTimezoneName: 'Australia/Sydney' },
      quotes: [{ date: '2026-11-01T23:00:00Z', close: 12 }],
    }).points).toEqual([{ t: '2026-11-02', c: 12 }]);
  });
});

describe('cotización sacada del gráfico', () => {
  const now = new Date('2026-11-17T10:00:00Z');
  const meta = { regularMarketPrice: 11, currency: 'EUR', longName: 'Banco Santander', instrumentType: 'EQUITY',
    fullExchangeName: 'MCE', fiftyTwoWeekLow: 5, fiftyTwoWeekHigh: 12 };
  it('con la sesión abierta compara con el cierre de la víspera', () => {
    const q = quoteFromChart('SAN.MC', { meta: { ...meta, regularMarketTime: new Date('2026-11-17T09:59:00Z') },
      quotes: [{ date: '2026-11-13T08:00:00Z', close: 9 }, { date: '2026-11-16T08:00:00Z', close: 10 }, { date: '2026-11-17T08:00:00Z', close: 11 }] }, now);
    expect(q).toMatchObject({ symbol: 'SAN.MC', price: 11, previousClose: 10, currency: 'EUR', name: 'Banco Santander', quoteType: 'EQUITY', low52: 5, high52: 12 });
    expect(q!.changePct).toBeCloseTo(0.1);
  });
  it('si la última barra es de una sesión anterior, esa es el cierre previo', () => {
    const q = quoteFromChart('SAN.MC', { meta: { ...meta, regularMarketTime: new Date('2026-11-17T09:59:00Z') },
      quotes: [{ date: '2026-11-13T08:00:00Z', close: 9 }, { date: '2026-11-16T08:00:00Z', close: 10 }] }, now);
    expect(q!.previousClose).toBe(10);
  });
  it('sin precio no hay cotización', () => {
    expect(quoteFromChart('X', { meta: { currency: 'EUR' }, quotes: [] }, now)).toBeNull();
  });
});
