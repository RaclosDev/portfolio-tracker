import { z } from 'zod';
import type { PricePoint } from '../types.ts';
import { computeLedger, identityByTicker, sortOperations } from './ledger.ts';
import { cents } from './money.ts';
import type { Instrument, Operation } from './schemas.ts';

const DAY = 86_400_000;
export const portfolioHistoryQuerySchema = z.object({
  from: z.iso.date().refine((s) => s >= '1900-01-01', 'La fecha debe ser posterior a 1900'),
  to: z.iso.date(),
}).refine(({ from, to }) => from <= to, 'La fecha inicial debe ser anterior a la final')
  .refine(({ from, to }) => Date.parse(to) - Date.parse(from) <= 100 * 366 * DAY, 'El periodo máximo es de 100 años');

/**
 * Cierres ajustados a la escala de hoy (los splits ya están aplicados a los cierres anteriores). Por eso el
 * número de acciones de una fecha se expresa también en la escala de hoy: se multiplica por los splits posteriores
 * a esa fecha, y no se vuelve a multiplicar al llegar el split.
 */
export interface DailyHistory {
  currency: string | null;
  points: PricePoint[];
}

export interface PortfolioHistoryPoint {
  date: string;
  valueEur: number | null;
  constantFxEur: number | null;
  fxEffectEur: number | null;
  /** Valor al cierre anterior al periodo, antes de sus compras y ventas. */
  startingValueEur: number | null;
  /** Resultado económico del periodo: valor final − inicial − compras + ventas + cobros. */
  resultEur: number | null;
  purchasesEur: number;
  salesEur: number;
  incomeEur: number;
  missing: string[];
}

export interface PortfolioHistory {
  from: string;
  to: string;
  points: PortfolioHistoryPoint[];
  stale: boolean;
  missing: string[];
  /** Serie separada con un conjunto fijo de valores; excluye también todas sus operaciones. */
  available?: {
    points: PortfolioHistoryPoint[];
    included: number;
    excluded: { ticker: string; name: string }[];
  };
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
}

/** No usa precios futuros ni arrastra indefinidamente cotizaciones de valores suspendidos. */
function reader(points: PricePoint[]) {
  const sorted = points.filter((p) => Number.isFinite(p.c) && p.c > 0)
    .map((p) => ({ date: p.t.slice(0, 10), c: p.c })).sort((a, b) => a.date.localeCompare(b.date));
  let cursor = -1;
  return (date: string): number | null => {
    while (cursor + 1 < sorted.length && sorted[cursor + 1]!.date <= date) cursor++;
    const point = sorted[cursor];
    return point && Date.parse(date) - Date.parse(point.date) <= 7 * DAY ? point.c : null;
  };
}

export function computePortfolioHistory(args: {
  operations: Operation[];
  instruments: Instrument[];
  prices: Record<string, DailyHistory>;
  fx: Record<string, PricePoint[]>;
  from: string;
  to: string;
}): PortfolioHistoryPoint[] {
  const { from, to, prices } = args;
  const instruments = new Map(args.instruments.map((i) => [i.ticker, i]));
  // Una posición es un ISIN: comprar con un ticker y vender con otro del mismo ISIN la cierra, como en el libro.
  const identity = identityByTicker(args.instruments);
  const keyOf = (ticker: string) => identity.get(ticker)?.key ?? ticker;
  const ops = sortOperations(args.operations);
  const income = new Map(computeLedger(ops, args.instruments).income.map((i) => [i.id, i.econEur]));
  // Splits de cada posición, para pasar sus acciones a la escala de hoy.
  const splits = new Map<string, { date: string; ratio: number }[]>();
  for (const op of ops) if (op.type === 'split') splits.set(keyOf(op.ticker), [...(splits.get(keyOf(op.ticker)) ?? []), { date: op.date, ratio: op.splitRatio ?? 1 }]);
  const laterSplits = (key: string, date: string) => (splits.get(key) ?? []).filter((s) => s.date > date).reduce((n, s) => n * s.ratio, 1);
  const priceReaders = new Map(Object.entries(prices).map(([symbol, series]) => [symbol, reader(series.points)]));
  const fxReaders = new Map(Object.entries(args.fx).map(([currency, series]) => [currency, reader(series)]));
  const fixedFx = new Map(Object.entries(args.fx).map(([currency, series]) => [currency, reader(series)(from)]));
  const shares = new Map<string, number>();
  const points: PortfolioHistoryPoint[] = [];
  let cursor = 0;
  let startingValueEur: number | null = null;
  let startingMissing: string[] = [];
  let purchasesEur = 0;
  let salesEur = 0;
  let incomeEur = 0;
  const transfers = new Map<string, number>();
  for (let date = shiftDate(from, -1); date <= to; date = shiftDate(date, 1)) {
    while (cursor < ops.length && ops[cursor]!.date <= date) {
      const op = ops[cursor++]!;
      const key = keyOf(op.ticker);
      const held = shares.get(key) ?? 0;
      if (op.date >= from) {
        if (op.type === 'buy') purchasesEur += op.amountEur;
        else if (op.type === 'sell') salesEur += op.amountEur;
        else incomeEur += income.get(op.id) ?? 0;
      }
      if (op.type === 'transfer_out' && op.transferRef) transfers.set(op.transferRef, op.amountEur);
      if (op.type === 'transfer_in' && op.transferRef) transfers.delete(op.transferRef);
      if (op.type === 'buy' || op.type === 'scrip' || op.type === 'transfer_in') shares.set(key, held + (op.shares ?? 0));
      else if (op.type === 'sell' || op.type === 'transfer_out') shares.set(key, held - (op.shares ?? 0));
      else if (op.type === 'split') shares.set(key, held * (op.splitRatio ?? 1));
    }
    let value = [...transfers.values()].reduce((sum, amount) => sum + amount, 0);
    let constant = value;
    let missingPrice = false;
    let missingFx = false;
    let missingFixedFx = false;
    const missing = new Set<string>();
    for (const [ticker, held] of shares) {
      if (held <= 1e-6) continue;
      const instrument = instruments.get(ticker);
      // Acciones en la escala de los cierres (la de hoy).
      const units = held * laterSplits(ticker, date);
      const symbol = instrument?.symbol;
      const price = symbol ? priceReaders.get(symbol)?.(date) : null;
      const currency = (symbol ? prices[symbol]?.currency : null) ?? instrument?.currency;
      if (price == null || !currency) {
        missingPrice = true;
        missing.add(ticker);
        continue;
      }
      const fx = currency === 'EUR' ? 1 : fxReaders.get(currency)?.(date);
      const fixed = currency === 'EUR' ? 1 : fixedFx.get(currency);
      if (fx == null) { missingFx = true; missing.add(`EUR/${currency}`); }
      else value += cents(units * price / fx);
      if (fixed == null) { missingFixedFx = true; missing.add(`EUR/${currency} al inicio`); }
      else constant += cents(units * price / fixed);
    }
    // En céntimos, posición a posición, como la valoración de hoy: el resultado cuadra con las cifras que se ven.
    const valueEur = missingPrice || missingFx ? null : cents(value);
    const constantFxEur = missingPrice || missingFixedFx ? null : cents(constant);
    if (date < from) {
      startingValueEur = valueEur;
      if (valueEur == null) startingMissing = [...missing].map((s) => `${s} al cierre previo`);
      continue;
    }
    points.push({ date, valueEur, constantFxEur,
      fxEffectEur: valueEur != null && constantFxEur != null ? cents(valueEur - constantFxEur) : null,
      startingValueEur, purchasesEur: cents(purchasesEur), salesEur: cents(salesEur), incomeEur: cents(incomeEur),
      resultEur: valueEur != null && startingValueEur != null ? cents(valueEur - startingValueEur - purchasesEur + salesEur + incomeEur) : null,
      missing: [...new Set([...missing, ...startingMissing])],
    });
  }
  return points;
}
