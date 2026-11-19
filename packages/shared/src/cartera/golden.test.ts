/**
 * Batería «dorada»: carteras ficticias con resultados calculados a mano, independientes del código.
 * Si alguno falla, el cálculo financiero ha cambiado: revisar antes de tocar el número esperado.
 */
import { describe, expect, it } from 'vitest';
import { quoteSession } from '../calc.ts';
import type { Quote } from '../types.ts';
import { averageNativePrice, computeLedger } from './ledger.ts';
import { instrumentInputSchema, operationInputSchema, type Operation, type OperationInput } from './schemas.ts';
import { valueCartera } from './view.ts';

let nextId = 1;
const op = (o: OperationInput): Operation => ({ id: nextId++, ...operationInputSchema.parse(o) });
const buy = (date: string, shares: number, amountEur: number, extra: Partial<OperationInput> = {}) =>
  op({ date, ticker: 'AAA', type: 'buy', shares, amountEur, ...extra });
const sell = (date: string, shares: number, amountEur: number, extra: Partial<OperationInput> = {}) =>
  op({ date, ticker: 'AAA', type: 'sell', shares, amountEur, ...extra });
const quote = (price: number, extra: Partial<Quote> = {}): Quote => ({
  symbol: 'AAA', name: 'AAA', currency: 'EUR', price, changePct: null, previousClose: null, low52: null, high52: null,
  quoteType: 'EQUITY', exchange: null, marketState: null, fetchedAt: '2026-11-19T10:00:00Z', stale: false, ...extra,
});
const value = (ops: Operation[], q: Quote, { currency = 'EUR', fx = {} as Record<string, number>, today = '2026-11-19' } = {}) =>
  valueCartera({
    ledger: computeLedger(ops),
    instruments: [instrumentInputSchema.parse({ ticker: 'AAA', symbol: 'AAA', currency })],
    quotes: { AAA: q },
    fx,
    today,
  });

describe('cartera dorada', () => {
  const base = () => [buy('2026-01-10', 10, 1000), buy('2026-02-10', 5, 600)];

  it('dos compras: valor, precio medio, latente y rentabilidad', () => {
    const v = value(base(), quote(130));
    const r = v.open[0]!;
    expect(r.ledger.shares).toBe(15);
    expect(r.ledger.costEur).toBeCloseTo(1600, 6);
    expect(r.valueEur).toBeCloseTo(1950, 6);
    expect(averageNativePrice(r.ledger, 'EUR', 1)).toBeCloseTo(106.6667, 4);
    expect(r.unrealizedEur).toBeCloseTo(350, 6);
    expect(r.unrealizedPct).toBeCloseTo(0.21875, 8);
    expect(r.weight).toBeCloseTo(1, 8);
  });

  it('venta parcial FIFO: realizado, coste restante y resultado histórico', () => {
    const v = value([...base(), sell('2026-03-10', 6, 835)], quote(130));
    const r = v.open[0]!;
    expect(r.ledger.sales[0]!.gainEur).toBeCloseTo(235, 6);
    expect(r.ledger.shares).toBe(9);
    expect(r.ledger.costEur).toBeCloseTo(1000, 6);
    expect(averageNativePrice(r.ledger, 'EUR', 1)).toBeCloseTo(111.1111, 4);
    expect(r.valueEur).toBeCloseTo(1170, 6);
    expect(r.unrealizedEur).toBeCloseTo(170, 6);
    expect(r.historicEur).toBeCloseTo(405, 6);
    expect(v.summary.totalEur).toBeCloseTo(405, 6);
  });

  it('dividendo: lo cobrado es el bruto menos comisiones y retención en origen', () => {
    const v = value([...base(), op({ date: '2026-06-01', ticker: 'AAA', type: 'dividend', amountEur: 20, withholdingForeign: 3 })], quote(130));
    expect(v.summary.dividendsEur).toBeCloseTo(17, 6);
    expect(v.open[0]!.historicEur).toBeCloseTo(367, 6);
  });

  it('split 2:1: el doble de acciones con el mismo coste', () => {
    const v = value([...base(), op({ date: '2026-07-01', ticker: 'AAA', type: 'split', amountEur: 0, splitRatio: 2 })], quote(65));
    const r = v.open[0]!;
    expect(r.ledger.shares).toBe(30);
    expect(r.ledger.costEur).toBeCloseTo(1600, 6);
    expect(r.valueEur).toBeCloseTo(1950, 6);
    expect(averageNativePrice(r.ledger, 'EUR', 1)).toBeCloseTo(53.3333, 4);
  });

  it('compra en dólares: valor al cambio de hoy, precio medio al cambio de la compra', () => {
    // 10 × 50 $ + 2 $ de comisión = 502 $ a 1,10 $/€ = 456,36 €.
    const ops = [buy('2026-01-10', 10, 456.36, { price: 50, fees: 2, fxRate: 1.1 })];
    const v = value(ops, quote(60, { currency: 'USD' }), { currency: 'USD', fx: { USD: 1.25 } });
    const r = v.open[0]!;
    expect(r.valueNative).toBeCloseTo(600, 6);
    expect(r.valueEur).toBeCloseTo(480, 6);
    expect(r.unrealizedEur).toBeCloseTo(23.64, 6);
    // El cambio de hoy (1,25) no altera lo que se pagó por acción en dólares.
    expect(averageNativePrice(r.ledger, 'USD', 1.25)).toBeCloseTo(50.2, 2);
  });

  it('dos brókers: la venta consume primero el lote más antiguo de cualquiera', () => {
    const ops = [
      buy('2026-01-10', 10, 1000, { broker: 'ING' }),
      buy('2026-02-10', 10, 1200, { broker: 'MyInvestor' }),
      sell('2026-03-10', 5, 650, { broker: 'MyInvestor' }),
    ];
    const t = computeLedger(ops).byTicker.get('AAA')!;
    expect(t.shares).toBe(15);
    expect(t.realizedEur).toBeGreaterThan(0);
    expect(t.costEur + t.sales[0]!.matches.reduce((s, m) => s + m.costEur, 0)).toBeCloseTo(2200, 6);
  });

  it('cierre total y nueva compra: la posición nueva empieza de cero', () => {
    const ops = [...base(), sell('2026-03-10', 15, 1800), buy('2026-04-10', 2, 250)];
    const v = value(ops, quote(130));
    const r = v.open[0]!;
    expect(r.ledger.shares).toBe(2);
    expect(r.ledger.costEur).toBeCloseTo(250, 6);
    expect(r.unrealizedEur).toBeCloseTo(10, 6);
    expect(v.summary.realizedEur).toBeCloseTo(200, 6);
  });

  it('variación del día: lo comprado hoy cuenta desde su precio de compra, no desde el cierre de ayer', () => {
    const today = '2026-11-19';
    const ops = [buy('2026-01-10', 10, 900), buy(today, 5, 525)];
    const v = value(ops, quote(110, { previousClose: 100 }), { today });
    // 10 × (110 − 100) + (5 × 110 − 525) = 100 + 25.
    expect(v.open[0]!.dayChangeEur).toBeCloseTo(125, 6);
    expect(v.summary.dayChangePct).toBeCloseTo(125 / (1650 - 125), 8);
  });
});

describe('quoteSession', () => {
  it('da la sesión del precio en hora de Madrid y, si no hay, la fecha del valor liquidativo', () => {
    expect(quoteSession({ priceTime: '2026-11-13T21:00:00Z' })).toBe('2026-11-13');
    expect(quoteSession({ asOf: '2026-11-12' })).toBe('2026-11-12');
    expect(quoteSession({ priceTime: 'basura', asOf: '2026-11-12T00:00:00Z' })).toBe('2026-11-12');
    expect(quoteSession(null)).toBeNull();
  });
});
