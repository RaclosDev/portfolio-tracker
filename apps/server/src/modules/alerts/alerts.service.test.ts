import { computeMetrics, DEFAULT_SETTINGS, type Item, type Settings, type WatchlistRow } from '@watchlist/shared';
import { describe, expect, it } from 'vitest';
import { AlertsService } from './alerts.service.ts';

const item = (id: number, listId: number, buyPrices: number[]): Item => ({
  id, listId, symbol: 'NVDA', ticker: null, isin: null, name: 'NVIDIA', buyPrices, brokerTarget: null, brokerName: null,
  investAmount: null, sharesOverride: null, orderActive: false, orderPrice: null, orderUntil: null, notes: null,
  mutedUntil: null, createdAt: '', updatedAt: '',
});
const row = (it: Item, price: number): WatchlistRow => {
  const quote = {
    symbol: 'NVDA', name: null, currency: 'USD', price, changePct: 0, previousClose: null, low52: null, high52: null,
    quoteType: 'EQUITY', exchange: null, marketState: null, fetchedAt: '', stale: false,
  };
  return { item: it, quote, targets: null, metrics: computeMetrics({ item: it, quote, targets: null, fxRate: 1, settings: DEFAULT_SETTINGS, today: '2026-11-19' }) };
};

function setup(rowsByList: WatchlistRow[][], pushResult = { sent: 1, failed: 0 }) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications, enabled: true, skipWeekends: false, quietHours: false, dailySummary: true, dailySummaryAt: '00:00' },
  };
  const state = new Map<string, unknown>([['ultimaCopia', '2026-11-19']]);
  const sent: string[] = [];
  const db = { tx: async (fn: (t: unknown) => unknown) => fn({ query: async () => [] }), query: async () => [] };
  const service = new AlertsService(
    db as never,
    { all: async () => rowsByList.map((_, i) => ({ id: i + 1 })) } as never,
    { get: async () => settings } as never,
    { get: async (k: string, d: unknown) => (state.has(k) ? state.get(k) : d), set: async (k: string, v: unknown) => void state.set(k, v) } as never,
    { view: async (id: number) => ({ rows: rowsByList[id - 1] }) } as never,
    { sendAll: async (p: { tag: string }) => (sent.push(p.tag), pushResult) } as never,
    {} as never,
  );
  return { service, state, sent };
}

describe('AlertsService', () => {
  it('evalúa el mismo valor en dos listas con niveles distintos', async () => {
    const { service } = setup([[row(item(1, 1, [150]), 129)], [row(item(2, 2, [130]), 129)]]);
    const alerts = await service.tick(new Date('2026-11-19T10:00:00Z'));
    expect(new Set(alerts.map((a) => a.itemId))).toEqual(new Set([1, 2]));
  });

  it('no da el resumen por enviado si falla en todos los dispositivos', async () => {
    const failing = setup([[row(item(1, 1, [150]), 200)]], { sent: 0, failed: 2 });
    await failing.service.tick(new Date('2026-11-19T10:00:00Z'));
    expect(failing.sent).toContain('resumen');
    expect(failing.state.has('ultimoResumen')).toBe(false);

    const ok = setup([[row(item(1, 1, [150]), 200)]], { sent: 1, failed: 1 });
    await ok.service.tick(new Date('2026-11-19T10:00:00Z'));
    expect(ok.state.get('ultimoResumen')).toBe('2026-11-19');
  });
});
