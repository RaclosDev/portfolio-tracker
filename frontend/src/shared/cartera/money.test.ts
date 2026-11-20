/** Que no baile ni un céntimo: cada cifra que se ve es la resta o la suma exacta de las que tiene al lado. */
import { describe, expect, it } from 'vitest';
import type { Quote } from '../types.ts';
import { computeExposure, type FundComposition } from './exposure.ts';
import { computeLedger } from './ledger.ts';
import { cents, splitCents } from './money.ts';
import { instrumentInputSchema, operationInputSchema, type Operation, type OperationInput } from './schemas.ts';
import { valueCartera, type HoldingRow } from './view.ts';

let nextId = 1;
const op = (o: OperationInput): Operation => ({ id: nextId++, ...operationInputSchema.parse(o) });
const quote = (symbol: string, price: number): Quote => ({
  symbol, name: symbol, currency: 'EUR', price, changePct: null, previousClose: null, low52: null, high52: null,
  quoteType: 'EQUITY', exchange: null, marketState: null, fetchedAt: '2026-11-19T10:00:00Z', stale: false,
});

describe('céntimos', () => {
  it('redondea la mitad hacia fuera aunque la coma flotante diga otra cosa', () => {
    expect(cents(1332.555)).toBe(1332.56);
    expect(cents(1.005)).toBe(1.01);
    expect(cents(-178.855)).toBe(-178.86);
    expect(cents(-0.004)).toBe(0);
    expect(Object.is(cents(-0.004), -0)).toBe(false);
  });

  it('reparte sin perder céntimos', () => {
    const parts = splitCents(100, [1 / 3, 1 / 3, 1 / 3]);
    expect(parts).toEqual([33.33, 33.34, 33.33]);
    expect(cents(parts.reduce((s, p) => s + p, 0))).toBe(100);
    expect(cents(splitCents(10, [0.25, 0.25]).reduce((s, p) => s + p, 0))).toBe(5);
  });

  it('el resultado de una fila es su valor − su coste, y el total la suma de las filas', () => {
    // 37 × 36,015 = 1.332,555 €: se ve 1.332,56 €, así que el resultado es 1.332,56 − 1.511,41 = −178,85 €.
    const ops = [
      op({ date: '2026-01-10', ticker: 'RRR', type: 'buy', shares: 37, amountEur: 1511.41 }),
      op({ date: '2026-01-10', ticker: 'SSS', type: 'buy', shares: 3, amountEur: 10 }),
    ];
    const v = valueCartera({
      ledger: computeLedger(ops),
      instruments: ['RRR', 'SSS'].map((t) => instrumentInputSchema.parse({ ticker: t, symbol: t, currency: 'EUR' })),
      quotes: { RRR: quote('RRR', 36.015), SSS: quote('SSS', 3.335) },
      fx: {},
      today: '2026-11-19',
    });
    const r = v.open.find((o) => o.ticker === 'RRR')!;
    expect(r.valueEur).toBe(1332.56);
    expect(r.unrealizedEur).toBe(-178.85);
    expect(r.historicEur).toBe(-178.85);
    const s = v.open.find((o) => o.ticker === 'SSS')!;
    expect(s.valueEur).toBe(10.01);
    expect(v.summary.valueEur).toBe(1342.57);
    expect(v.summary.unrealizedEur).toBe(cents(r.unrealizedEur! + s.unrealizedEur!));
  });

  it('el coste de una venta parcial va en céntimos y la ganancia es la resta exacta', () => {
    // 115 de 250 acciones que costaron 4.965,25 €: 2.284,015 → 2.284,02 €; 5.165,21 − 2.284,02 = 2.881,19 €.
    const ops = [
      op({ date: '2025-01-10', ticker: 'III', type: 'buy', shares: 250, amountEur: 4965.25 }),
      op({ date: '2025-06-10', ticker: 'III', type: 'sell', shares: 115, amountEur: 5165.21 }),
      op({ date: '2025-07-10', ticker: 'III', type: 'sell', shares: 135, amountEur: 6000 }),
    ];
    const l = computeLedger(ops);
    const [a, b] = l.sales;
    expect(a!.costEur).toBe(2284.02);
    expect(a!.gainEur).toBe(2881.19);
    expect(a!.taxGainEur).toBe(2881.19);
    // La última venta se lleva lo que queda del lote: entre las dos, el coste entero.
    expect(b!.costEur).toBe(2681.23);
    expect(cents(a!.costEur + b!.costEur)).toBe(4965.25);
  });

  it('la exposición suma justo el valor de la cartera, céntimo a céntimo', () => {
    const fund = { ticker: 'FND', name: 'Fondo', valueEur: 1000.01, quote: { quoteType: 'ETF' }, instrument: { isin: null } } as unknown as HoldingRow;
    const composition: FundComposition = {
      holdings: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ name: `Empresa ${i}`, isin: null, ticker: null, weight: 0.13 })),
      asOf: null, source: 'prueba', fetchedAt: '2026-11-19T00:00:00.000Z',
    };
    const e = computeExposure([fund], { FND: composition });
    for (const r of e.rows) expect(r.totalEur).toBe(cents(r.totalEur));
    const rows = cents(e.rows.reduce((s, r) => s + r.totalEur, 0));
    expect(cents(rows + e.restEur)).toBe(e.totalEur);
    expect(e.totalEur).toBe(1000.01);
  });
});
