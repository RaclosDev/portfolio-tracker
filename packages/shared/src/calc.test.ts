import { describe, expect, it } from 'vitest';
import { computeMetrics, daysBetween, levelStatus, roundUpShares } from './calc.ts';
import { DEFAULT_SETTINGS } from './schemas.ts';
import type { Item, Quote } from './types.ts';

const item = (over: Partial<Item> = {}): Item => ({
  id: 1,
  listId: 1,
  symbol: 'MCD',
  name: null,
  buyPrices: [212.5, 196],
  brokerTarget: null,
  brokerName: null,
  investAmount: 2500,
  sharesOverride: 14,
  orderActive: false,
  orderPrice: null,
  orderUntil: null,
  notes: null,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const quote = (price: number): Quote => ({
  symbol: 'MCD',
  name: null,
  currency: 'USD',
  price,
  changePct: 0,
  previousClose: null,
  low52: null,
  high52: null,
  quoteType: null,
  exchange: null,
  marketState: null,
  fetchedAt: '',
  stale: false,
});
const base = { targets: null, settings: DEFAULT_SETTINGS, today: '2026-11-07' };

describe('levelStatus', () => {
  it('clasifica alcanzado / cerca / lejos', () => {
    expect(levelStatus(10, 9.9, 5)).toBe('reached');
    expect(levelStatus(10, 10.4, 5)).toBe('near');
    expect(levelStatus(10, 12, 5)).toBe('far');
    expect(levelStatus(10, null, 5)).toBe('unknown');
  });
});

describe('computeMetrics', () => {
  it('reproduce el cálculo del Excel para un valor en USD (MCD)', () => {
    const m = computeMetrics({ ...base, item: item(), quote: quote(276.47), fxRate: 1.1143 });
    expect(m.levels[0]!.distancePct).toBeCloseTo(-0.23138, 4);
    expect(m.levels[1]!.distancePct).toBeCloseTo(-0.29106, 4);
    expect(m.sharesCalc).toBeCloseTo(13.1094, 3);
    expect(m.netNative).toBe(2975);
    expect(m.netBase).toBeCloseTo(2975 / 1.1143, 4);
    expect(m.diffBase).toBeCloseTo((14 * (276.47 - 212.5)) / 1.1143, 4);
    expect(m.nearestDistancePct).toBeCloseTo(-0.23138, 4);
  });

  it('sin niveles de compra no rompe', () => {
    const m = computeMetrics({
      ...base,
      item: item({ sharesOverride: null, buyPrices: [] }),
      quote: quote(10),
      fxRate: 1,
    });
    expect(m.sharesCalc).toBeNull();
    expect(m.shares).toBeNull();
    expect(m.status).toBe('unknown');
  });

  it('usa el precio de la orden activa y calcula días restantes', () => {
    const m = computeMetrics({
      ...base,
      item: item({ orderActive: true, orderPrice: 64.2, orderUntil: '2026-11-30', sharesOverride: null }),
      quote: quote(68.6),
      fxRate: 1,
    });
    expect(m.entryPrice).toBe(64.2);
    expect(m.shares).toBe(39); // 38,94 → siempre hacia arriba
    expect(m.orderDaysLeft).toBe(23);
    expect(m.orderExpired).toBe(false);
  });

  it('marca alcanzado si el precio cae por debajo de un nivel', () => {
    const m = computeMetrics({ ...base, item: item(), quote: quote(210), fxRate: 1 });
    expect(m.status).toBe('reached');
    expect(m.nearestDistancePct).toBe(0);
  });
});

describe('roundUpShares', () => {
  it('redondea siempre a la unidad superior', () => {
    expect(roundUpShares(294.12)).toBe(295);
    expect(roundUpShares(13.01)).toBe(14);
  });
  it('no añade una acción si el cálculo es exacto (aunque haya error de coma flotante)', () => {
    expect(roundUpShares(200)).toBe(200);
    expect(roundUpShares(200.0000000000001)).toBe(200);
  });
});

describe('daysBetween', () => {
  it('cuenta días naturales', () => expect(daysBetween('2026-11-07', '2026-11-06')).toBe(-1));
});
