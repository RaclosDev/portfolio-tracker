/** Valoración de la cartera con los precios de hoy: lo que se ve en Resumen, En cartera y Cerradas. */
import type { Quote } from '../types.ts';
import type { Ledger, TickerLedger } from './ledger.ts';
import type { Instrument } from './schemas.ts';

export interface CarteraRowBase {
  ticker: string;
  instrument: Instrument | null;
  quote: Quote | null;
  ledger: TickerLedger;
  name: string;
  sector: string | null;
  /** Divisa en la que cotiza. */
  currency: string;
  price: number | null;
  changePct: number | null;
  /** Unidades de la divisa por 1 €. */
  fxRate: number | null;
}

export interface HoldingRow extends CarteraRowBase {
  valueNative: number | null;
  valueEur: number | null;
  dayChangeEur: number | null;
  /** Plusvalía latente: valor − coste de las acciones que quedan. */
  unrealizedEur: number | null;
  unrealizedPct: number | null;
  /** Todo lo ganado con este valor desde la primera compra: ventas + cobros + latente. */
  historicEur: number | null;
  weight: number | null;
}

export interface ClosedRow extends CarteraRowBase {
  totalEur: number;
}

export interface CarteraSummary {
  valueEur: number;
  costEur: number;
  dayChangeEur: number;
  dayChangePct: number | null;
  unrealizedEur: number;
  realizedEur: number;
  dividendsEur: number;
  otherIncomeEur: number;
  incomeEur: number;
  totalEur: number;
  /** Posiciones abiertas sin precio o sin cambio de divisa: no suman en valor ni latente. */
  missing: string[];
  /** Rentabilidad anual (TIR) del dinero invertido, con el valor de hoy como si se vendiera. */
  xirr: number | null;
  /** Total invertido en compras desde el principio. */
  boughtEur: number;
}

export interface CarteraValuation {
  open: HoldingRow[];
  closed: ClosedRow[];
  summary: CarteraSummary;
  bySector: { sector: string; valueEur: number }[];
}

const DAY = 86_400_000;

/** TIR anual de flujos con fecha (negativo = sale dinero). null si no converge o no hay signos distintos. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  const fl = flows.filter((f) => Math.abs(f.amount) > 0.005);
  if (!fl.some((f) => f.amount < 0) || !fl.some((f) => f.amount > 0)) return null;
  const t0 = Date.parse(fl.reduce((a, f) => (f.date < a ? f.date : a), fl[0]!.date));
  const years = fl.map((f) => (Date.parse(f.date) - t0) / DAY / 365);
  const npv = (r: number) => fl.reduce((s, f, i) => s + f.amount / (1 + r) ** years[i]!, 0);
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export function valueCartera(args: {
  ledger: Ledger;
  instruments: Instrument[];
  /** Cotizaciones por símbolo de Yahoo. */
  quotes: Record<string, Quote>;
  /** Unidades de cada divisa por 1 €. */
  fx: Record<string, number>;
  today: string;
}): CarteraValuation {
  const { ledger, quotes, fx, today } = args;
  const inst = new Map(args.instruments.map((i) => [i.ticker, i]));

  const base = (t: TickerLedger): CarteraRowBase => {
    const instrument = inst.get(t.ticker) ?? null;
    const quote = instrument?.symbol ? (quotes[instrument.symbol] ?? null) : null;
    const currency = quote?.currency ?? instrument?.currency ?? 'EUR';
    return {
      ticker: t.ticker,
      instrument,
      quote,
      ledger: t,
      name: instrument?.name ?? quote?.name ?? t.ticker,
      sector: instrument?.sector ?? null,
      currency,
      price: quote?.price ?? null,
      changePct: quote?.changePct ?? null,
      fxRate: currency === 'EUR' ? 1 : (fx[currency] ?? null),
    };
  };

  const open: HoldingRow[] = [];
  const closed: ClosedRow[] = [];
  for (const t of ledger.tickers) {
    const b = base(t);
    if (t.shares > 0) {
      const valueNative = b.price != null ? t.shares * b.price : null;
      const valueEur = valueNative != null && b.fxRate ? valueNative / b.fxRate : null;
      const prev = b.quote?.previousClose ?? (b.price != null && b.changePct != null ? b.price / (1 + b.changePct) : null);
      const dayChangeEur = b.price != null && prev != null && b.fxRate ? (t.shares * (b.price - prev)) / b.fxRate : null;
      const unrealizedEur = valueEur != null ? valueEur - t.costEur : null;
      open.push({
        ...b,
        valueNative,
        valueEur,
        dayChangeEur,
        unrealizedEur,
        unrealizedPct: unrealizedEur != null && t.costEur > 0 ? unrealizedEur / t.costEur : null,
        historicEur: unrealizedEur != null ? unrealizedEur + t.realizedEur + t.dividendsEur + t.otherIncomeEur : null,
        weight: null,
      });
    } else {
      closed.push({ ...b, totalEur: t.realizedEur + t.dividendsEur + t.otherIncomeEur });
    }
  }

  const valueEur = open.reduce((s, r) => s + (r.valueEur ?? 0), 0);
  for (const r of open) r.weight = r.valueEur != null && valueEur ? r.valueEur / valueEur : null;
  const priced = open.filter((r) => r.valueEur != null);
  const costEur = priced.reduce((s, r) => s + r.ledger.costEur, 0);
  const dayChangeEur = open.reduce((s, r) => s + (r.dayChangeEur ?? 0), 0);
  const unrealizedEur = valueEur - costEur;
  const all = ledger.tickers;
  const realizedEur = all.reduce((s, t) => s + t.realizedEur, 0);
  const dividendsEur = all.reduce((s, t) => s + t.dividendsEur, 0);
  const otherIncomeEur = all.reduce((s, t) => s + t.otherIncomeEur, 0);
  const missing = open.filter((r) => r.valueEur == null).map((r) => r.ticker);

  // TIR: compras (sale dinero), ventas y cobros (entra) y el valor de hoy.
  const flows: { date: string; amount: number }[] = [];
  for (const t of all) {
    for (const l of [...t.openLots, ...t.closedLots]) if (l.costBought > 0) flows.push({ date: l.date, amount: -l.costBought });
    for (const s of t.sales) flows.push({ date: s.date, amount: s.proceedsEur });
    for (const i of t.income) flows.push({ date: i.date, amount: i.econEur });
  }
  flows.push({ date: today, amount: valueEur });

  const sectors = new Map<string, number>();
  for (const r of priced) sectors.set(r.sector ?? 'Sin sector', (sectors.get(r.sector ?? 'Sin sector') ?? 0) + r.valueEur!);

  return {
    open,
    closed,
    summary: {
      valueEur,
      costEur,
      dayChangeEur,
      dayChangePct: valueEur - dayChangeEur ? dayChangeEur / (valueEur - dayChangeEur) : null,
      unrealizedEur,
      realizedEur,
      dividendsEur,
      otherIncomeEur,
      incomeEur: dividendsEur + otherIncomeEur,
      totalEur: unrealizedEur + realizedEur + dividendsEur + otherIncomeEur,
      missing,
      xirr: missing.length ? null : xirr(flows),
      boughtEur: all.reduce((s, t) => s + t.boughtEur, 0),
    },
    bySector: [...sectors].map(([sector, v]) => ({ sector, valueEur: v })).sort((a, b) => b.valueEur - a.valueEur),
  };
}
