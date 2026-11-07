import { describe, expect, it } from 'vitest';
import { emptyMemory, evaluateAlerts, evaluateSellAlerts, DEFAULT_ALERT_PREFS, type AlertMemory } from './alerts.ts';
import { computeMetrics, computePositionMetrics } from './calc.ts';
import { DEFAULT_SETTINGS } from './schemas.ts';
import type { Item, PortfolioRow, Position, WatchlistRow } from './types.ts';

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
  mutedUntil: null,
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

describe('silenciar y resumen diario', () => {
  it('isMuted respeta la fecha (incluida) y "siempre"', async () => {
    const { isMuted } = await import('./alerts.ts');
    expect(isMuted(null, '2026-11-07')).toBe(false);
    expect(isMuted('2026-11-07', '2026-11-07')).toBe(true);
    expect(isMuted('2026-11-06', '2026-11-07')).toBe(false);
    expect(isMuted('always', '2026-11-07')).toBe(true);
  });

  it('el resumen lista lo que está en zona y cerca', async () => {
    const { buildDailySummary } = await import('./alerts.ts');
    const s = buildDailySummary([row(16), row(17.5, { id: 8, name: 'Viscofan' })])!;
    expect(s.body).toContain('En zona: Fluidra');
    expect(s.body).toContain('Cerca: Viscofan');
  });

  it('el resumen diario menciona los resultados de hoy o mañana', async () => {
    const { buildDailySummary } = await import('./alerts.ts');
    const r = row(16);
    const targets = {
      mean: null, median: null, high: null, low: null, analysts: null, recommendation: null, recommendationMean: null,
      nextEarnings: '2026-11-08', fetchedAt: '',
    };
    const s = buildDailySummary([{ ...r, targets }], new Date(2026, 10, 7, 9))!;
    expect(s.body).toContain('Resultados: Fluidra (mañana)');
  });

  it('los avisos llevan el ticker del valor', () => {
    const { alerts } = evaluateAlerts([row(16)], emptyMemory(), DEFAULT_ALERT_PREFS, t0);
    expect(alerts[0]!.symbol).toBe('FDR.MC');
  });
});

describe('evaluateSellAlerts', () => {
  const position: Position = {
    id: 3, symbol: 'ITX.MC', name: 'Inditex', shares: 50, avgPrice: 40, costBase: null, buyDate: null, sellTarget: 50,
    notes: null, mutedUntil: null, createdAt: '', updatedAt: '',
  };
  const prow = (price: number): PortfolioRow => {
    const quote = {
      symbol: 'ITX.MC', name: null, currency: 'EUR', price, changePct: 0, previousClose: price, low52: null, high52: null,
      quoteType: 'EQUITY', exchange: null, marketState: null, fetchedAt: '', stale: false,
    };
    return { position, quote, targets: null, metrics: { ...computePositionMetrics({ position, quote, fxRate: 1, sellNearPct: 3 }), weight: 1 } };
  };

  it('avisa cerca del objetivo y al alcanzarlo, una vez cada cosa', () => {
    let memory = emptyMemory();
    const kinds = [45, 48.8, 49, 50.5, 51].map((p, i) => {
      const res = evaluateSellAlerts([prow(p)], memory, DEFAULT_ALERT_PREFS, later(i));
      memory = res.memory;
      return res.alerts.map((a) => a.kind).join();
    });
    expect(kinds).toEqual(['', 'sellNear', '', 'sellReached', '']);
  });

  it('las alertas de compra no borran la memoria de la cartera', () => {
    const { memory } = evaluateSellAlerts([prow(49)], emptyMemory(), DEFAULT_ALERT_PREFS, t0);
    const after = evaluateAlerts([row(20)], memory, DEFAULT_ALERT_PREFS, t0).memory;
    expect(Object.keys(after.levels).some((k) => k.startsWith('sell:'))).toBe(true);
  });
});
