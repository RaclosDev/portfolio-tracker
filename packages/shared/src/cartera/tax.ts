/**
 * Informe para la Renta (base del ahorro del IRPF) a partir del libro de la cartera.
 *
 *  - Ganancias y pérdidas patrimoniales: ventas de acciones (FIFO, coste fiscal) y venta de derechos.
 *  - Rendimientos del capital mobiliario (RCM): dividendos, primas de asistencia y exceso de prima de emisión.
 *  - Compensación (art. 49 LIRPF): un saldo negativo de ganancias compensa hasta el 25 % del saldo
 *    positivo de RCM del año (y al revés); lo que quede se arrastra cuatro años.
 *
 * Es una ayuda para preparar la declaración, no un cálculo oficial.
 */
import type { IncomeItem, Ledger, Sale } from './ledger.ts';

/** Retención española general sobre dividendos y demás RCM. */
export const ES_WITHHOLDING_RATE = 0.19;
/** Desde este año, los dividendos importados sin retención se estiman al 19 % (la Renta de esos años está pendiente). */
export const ESTIMATE_WITHHOLDING_FROM = 2026;

/** Escala del ahorro (estatal + autonómica) vigente desde 2025. */
export const SAVINGS_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 6_000, rate: 0.19 },
  { upTo: 50_000, rate: 0.21 },
  { upTo: 200_000, rate: 0.23 },
  { upTo: 300_000, rate: 0.27 },
  { upTo: Infinity, rate: 0.3 },
];

/** Porcentaje de compensación cruzada entre ganancias y RCM según el año. */
export function crossCompensationPct(year: number) {
  if (year <= 2014) return 0;
  if (year === 2015) return 0.1;
  if (year === 2016) return 0.15;
  if (year === 2017) return 0.2;
  return 0.25;
}

export function savingsTax(base: number): number {
  let tax = 0;
  let prev = 0;
  for (const b of SAVINGS_BRACKETS) {
    if (base <= prev) break;
    tax += (Math.min(base, b.upTo) - prev) * b.rate;
    prev = b.upTo;
  }
  return tax;
}

export interface IncomeLine {
  item: IncomeItem;
  /** Retención española que se usa (la apuntada o la estimada). */
  withholdingEs: number;
  estimated: boolean;
}

export interface CarryLoss {
  year: number;
  amount: number;
}

export interface TaxYear {
  year: number;
  sales: Sale[];
  rights: IncomeItem[];
  rcmLines: IncomeLine[];
  /** Ganancias y pérdidas patrimoniales declarables (ventas + derechos). */
  gains: number;
  losses: number;
  /** Pérdidas de este año aplazadas por la regla de los dos meses. */
  deferred: number;
  /** Pérdidas aplazadas antes que se integran este año. */
  released: number;
  gpBalance: number;
  rcmGross: number;
  rcmFees: number;
  rcmBalance: number;
  withholdingEs: number;
  withholdingEsEstimated: number;
  withholdingForeign: number;
  /** Deducción por doble imposición internacional estimada: lo pagado fuera, hasta el 19 % del rendimiento. */
  foreignDeduction: number;
  /** Compensación entre ganancias y RCM de este mismo año. */
  crossCompensation: number;
  /** Pérdidas de años anteriores que se compensan este año. */
  carriedUsed: CarryLoss[];
  /** Pérdidas pendientes al acabar el año (para los cuatro siguientes). */
  carriedPending: CarryLoss[];
  gpBase: number;
  rcmBase: number;
  taxBase: number;
  taxEstimate: number;
  /** Cuota estimada menos retenciones y deducción: positivo = a pagar. */
  balanceEstimate: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function withholdingFor(item: IncomeItem): { value: number; estimated: boolean } {
  if (item.withholdingEs != null) return { value: item.withholdingEs, estimated: false };
  if (item.source === 'excel' && item.year >= ESTIMATE_WITHHOLDING_FROM && item.rcmEur > 0)
    return { value: round2(item.rcmEur * ES_WITHHOLDING_RATE), estimated: true };
  return { value: 0, estimated: false };
}

/** Un informe por año, desde el primer año con operaciones hasta `lastYear`. */
export function computeTaxYears(ledger: Ledger, lastYear = new Date().getFullYear()): TaxYear[] {
  const years = new Set<number>([...ledger.sales.map((s) => s.year), ...ledger.income.map((i) => i.year)]);
  if (!years.size) return [];
  const first = Math.min(...years);
  const out: TaxYear[] = [];
  let pending: CarryLoss[] = [];

  for (let year = first; year <= Math.max(lastYear, ...years); year++) {
    const sales = ledger.sales.filter((s) => s.year === year);
    const rights = ledger.income.filter((i) => i.year === year && i.type === 'rights_sale' && Math.abs(i.gainEur) > 0.005);
    const rcmItems = ledger.income.filter((i) => i.year === year && Math.abs(i.rcmEur) > 0.005);
    const rcmLines = rcmItems.map((item) => {
      const w = withholdingFor(item);
      return { item, withholdingEs: w.value, estimated: w.estimated };
    });

    const gpValues = [...sales.map((s) => s.computableEur), ...rights.map((r) => r.gainEur)];
    const gains = gpValues.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const losses = gpValues.filter((v) => v < 0).reduce((a, b) => a + b, 0);
    const gpBalance = gains + losses;
    const rcmGross = rcmItems.reduce((s, i) => s + i.grossEur, 0);
    const rcmFees = rcmItems.reduce((s, i) => s + i.feesEur, 0);
    const rcmBalance = rcmItems.reduce((s, i) => s + i.rcmEur, 0);

    // Compensación del propio año.
    const pctCross = crossCompensationPct(year);
    let gp = gpBalance;
    let rcm = rcmBalance;
    let crossCompensation = 0;
    let rcmCap = Math.max(0, rcm) * pctCross;
    if (gp < 0 && rcm > 0) {
      crossCompensation = Math.min(-gp, rcmCap);
      gp += crossCompensation;
      rcm -= crossCompensation;
      rcmCap -= crossCompensation;
    } else if (rcm < 0 && gp > 0) {
      crossCompensation = Math.min(-rcm, gp * pctCross);
      rcm += crossCompensation;
      gp -= crossCompensation;
    }

    // Pérdidas de los cuatro años anteriores (las más antiguas primero).
    pending = pending.filter((p) => p.year >= year - 4 && p.amount > 0.005);
    const carriedUsed: CarryLoss[] = [];
    for (const p of pending) {
      let used = 0;
      if (gp > 0) {
        const u = Math.min(p.amount, gp);
        gp -= u;
        used += u;
      }
      if (p.amount - used > 0.005 && rcm > 0 && rcmCap > 0) {
        const u = Math.min(p.amount - used, rcmCap, rcm);
        rcm -= u;
        rcmCap -= u;
        used += u;
      }
      if (used > 0.005) {
        p.amount -= used;
        carriedUsed.push({ year: p.year, amount: round2(used) });
      }
    }
    if (gp < -0.005) {
      pending.push({ year, amount: -gp });
      gp = 0;
    }
    pending = pending.filter((p) => p.amount > 0.005);

    const withholdingEs = rcmLines.reduce((s, l) => s + l.withholdingEs, 0);
    const withholdingEsEstimated = rcmLines.filter((l) => l.estimated).reduce((s, l) => s + l.withholdingEs, 0);
    const withholdingForeign = rcmItems.reduce((s, i) => s + (i.withholdingForeign ?? 0), 0);
    const foreignDeduction = rcmItems.reduce(
      (s, i) => s + Math.min(i.withholdingForeign ?? 0, Math.max(0, i.rcmEur) * ES_WITHHOLDING_RATE),
      0,
    );
    const gpBase = Math.max(0, gp);
    const rcmBase = Math.max(0, rcm);
    const taxBase = gpBase + rcmBase;
    const taxEstimate = savingsTax(taxBase);
    out.push({
      year,
      sales,
      rights,
      rcmLines,
      gains,
      losses,
      deferred: sales.reduce((s, x) => s + x.deferredLossEur, 0),
      released: sales.reduce((s, x) => s + x.releasedLossEur, 0),
      gpBalance,
      rcmGross,
      rcmFees,
      rcmBalance,
      withholdingEs,
      withholdingEsEstimated,
      withholdingForeign,
      foreignDeduction,
      crossCompensation,
      carriedUsed,
      carriedPending: pending.map((p) => ({ year: p.year, amount: round2(p.amount) })),
      gpBase,
      rcmBase,
      taxBase,
      taxEstimate,
      balanceEstimate: taxEstimate - withholdingEs - foreignDeduction,
    });
  }
  return out;
}
