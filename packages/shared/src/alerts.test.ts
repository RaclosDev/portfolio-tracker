import { describe, expect, it } from 'vitest';
import { emptyMemory, evaluateAlerts, DEFAULT_ALERT_PREFS, type AlertMemory } from './alerts.ts';
import { computeMetrics } from './calc.ts';
import { DEFAULT_SETTINGS } from './schemas.ts';
import type { Item, WatchlistRow } from './types.ts';

const baseItem: Item = {
  id: 7,
  listId: 1,
  symbol: 'FDR.MC',
  name: 'Fluidra',
  buyPrices: [17],
  brokerTarget: null,
  brokerName: null,
  investAmount: null,
  sharesOverride: null,
  orderActive: false,
  orderPrice: null,
  orderUntil: null,
  notes: null,
  createdAt: '',
  updatedAt: '',
};

function row(price: number, over: Partial<Item> = {}, today = '2026-11-07'): WatchlistRow {
  const item = { ...baseItem, ...over };
  const quote = {
    symbol: item.symbol, name: null, currency: 'EUR', price, changePct: 0, previousClose: null, low52: null,
    high52: null, quoteType: 'EQUITY', exchange: null, marketState: null, fetchedAt: '', stale: false,
  };
  return { item, quote, targets: null, metrics: computeMetrics({ item, quote, targets: null, fxRate: 1, settings: DEFAULT_SETTINGS, today }) };
}

const t0 = new Date('2026-11-07T10:00:00Z');
const later = (h: number) => new Date(t0.getTime() + h * 3_600_000);

function run(prices: number[], start: AlertMemory = emptyMemory(), hoursStep = 1) {
  let memory = start;
  const kinds: string[][] = [];
  prices.forEach((p, i) => {
    const res = evaluateAlerts([row(p)], memory, DEFAULT_ALERT_PREFS, later(i * hoursStep));
    memory = res.memory;
    kinds.push(res.alerts.map((a) => a.kind));
  });
  return kinds;
}

describe('evaluateAlerts', () => {
  it('avisa al acercarse y al entrar en zona, una sola vez cada cosa', () => {
    // 20 € (lejos) → 17,5 € (cerca) → 17,4 € (sigue cerca) → 16,9 € (en zona) → 16,8 €
    expect(run([20, 17.5, 17.4, 16.9, 16.8])).toEqual([[], ['near'], [], ['reached'], []]);
  });

  it('la primera vez avisa si ya está cerca o en zona, no si está lejos', () => {
    expect(run([20])).toEqual([[]]);
    expect(run([17.5])).toEqual([['near']]);
    expect(run([16])).toEqual([['reached']]);
  });

  it('no repite el aviso si el precio oscila en el límite (12 h), pero sí después', () => {
    expect(run([16.9, 17.6, 16.9])).toEqual([['reached'], [], []]); // cada hora
    expect(run([16.9, 17.6, 16.9], emptyMemory(), 13)).toEqual([['reached'], [], ['reached']]);
  });

  it('respeta las preferencias', () => {
    const res = evaluateAlerts([row(16)], emptyMemory(), { ...DEFAULT_ALERT_PREFS, reached: false }, t0);
    expect(res.alerts).toEqual([]);
  });

  it('avisa del precio en la orden y de su caducidad', () => {
    const r = row(64, { orderActive: true, orderPrice: 64.2, orderUntil: '2026-11-08', buyPrices: [] });
    const { alerts, memory } = evaluateAlerts([r], emptyMemory(), DEFAULT_ALERT_PREFS, t0);
    expect(alerts.map((a) => a.kind).sort()).toEqual(['orderExpiring', 'orderTouched']);
    expect(alerts.find((a) => a.kind === 'orderExpiring')!.title).toContain('caduca mañana');
    // La siguiente comprobación del mismo día no repite nada
    expect(evaluateAlerts([r], memory, DEFAULT_ALERT_PREFS, later(1)).alerts).toEqual([]);
  });

  it('no avisa con datos antiguos (sin conexión)', () => {
    const r = row(16);
    r.quote!.stale = true;
    expect(evaluateAlerts([r], emptyMemory(), DEFAULT_ALERT_PREFS, t0).alerts).toEqual([]);
  });
});
