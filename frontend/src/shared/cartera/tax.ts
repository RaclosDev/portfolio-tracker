/**
 * Informe para la Renta (base del ahorro del IRPF) a partir del libro de la cartera.
 *
 *  - Ganancias y pérdidas patrimoniales: ventas de acciones (FIFO, coste fiscal) y venta de derechos.
 *  - Rendimientos del capital mobiliario (RCM): dividendos, primas de asistencia y exceso de prima de emisión.
 *  - Compensación (art. 49 LIRPF): un saldo negativo de ganancias compensa hasta el 25 % del saldo
 *    positivo de RCM del año (y al revés); lo que quede (de ganancias o de RCM) se arrastra cuatro años.
 *
 * Es una ayuda para preparar la declaración, no un cálculo oficial.
 */
import type { IncomeItem, Ledger, Sale } from './ledger.ts';

/** Retención española general sobre dividendos y demás RCM. */
export const ES_WITHHOLDING_RATE = 0.19;
/** Desde este año, los dividendos importados sin retención se estiman al 19 % (la Renta de esos años está pendiente). */
export const ESTIMATE_WITHHOLDING_FROM = 2026;

/**
 * Tipo máximo de retención en origen que el convenio de doble imposición con España permite a cada país
 * (artículo de dividendos, inversor particular sin participación significativa). Solo se puede deducir en
 * España lo retenido hasta ese tipo; el exceso se reclama en el país de origen. La clave es el prefijo del ISIN.
 * Fuente: convenios para evitar la doble imposición suscritos por España (BOE) y su tipo para dividendos de cartera.
 *  - FR: el convenio fija el 15 %; el 12,8 % es la retención interna francesa para particulares, que es lo que
 *    se retiene en la práctica y, por ser menor, es lo que acaba deduciéndose.
 *  - GB e IE: sin retención en origen sobre dividendos de cartera (Reino Unido no retiene; los ETF irlandeses
 *    no retienen a no residentes), así que no hay nada que deducir.
 *  - ES: es retención española, no de origen.
 * Es una orientación para la estimación, no un cálculo oficial.
 */
export const TREATY_RATES: Readonly<Record<string, number>> = {
  US: 0.15,
  DE: 0.15,
  CH: 0.15,
  FR: 0.15,
  NL: 0.15,
  IT: 0.15,
  PT: 0.15,
  BE: 0.15,
  DK: 0.15,
  SE: 0.15,
  FI: 0.15,
  NO: 0.15,
  AT: 0.15,
  LU: 0.15,
  CA: 0.15,
  AU: 0.15,
  JP: 0.1,
  GB: 0,
  IE: 0,
  ES: 0,
};
/** Tipo de convenio para un país que no está en la tabla (o un valor sin ISIN). */
export const DEFAULT_TREATY_RATE = 0.15;

/** Tipo máximo del convenio para un valor, a partir del prefijo de su ISIN. */
export function treatyRate(isin: string | null | undefined): number {
  const country = isin?.trim().slice(0, 2).toUpperCase();
  if (country && Object.hasOwn(TREATY_RATES, country)) return TREATY_RATES[country]!;
  return DEFAULT_TREATY_RATE;
}

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
  /** Saldo negativo de rendimientos del capital mobiliario (si falta, es de ganancias y pérdidas). */
  kind?: 'rcm';
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
  /**
   * Deducción por doble imposición internacional estimada: lo retenido fuera hasta el tipo del convenio y
   * hasta el impuesto español de esa renta (al tipo medio), sin pasar de la cuota.
   */
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
  /** Cuota estimada tras la deducción, menos retenciones: positivo = a pagar. */
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
  let pendingRcm: CarryLoss[] = [];

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
    let gpCap = Math.max(0, gp) * pctCross;
    if (gp < 0 && rcm > 0) {
      crossCompensation = Math.min(-gp, rcmCap);
      gp += crossCompensation;
      rcm -= crossCompensation;
      rcmCap -= crossCompensation;
    } else if (rcm < 0 && gp > 0) {
      crossCompensation = Math.min(-rcm, gpCap);
      rcm += crossCompensation;
      gp -= crossCompensation;
      gpCap -= crossCompensation;
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
    // Saldos negativos de RCM de los cuatro años anteriores: contra RCM y, hasta el límite, contra ganancias.
    pendingRcm = pendingRcm.filter((p) => p.year >= year - 4 && p.amount > 0.005);
    for (const p of pendingRcm) {
      let used = 0;
      if (rcm > 0) {
        const u = Math.min(p.amount, rcm);
        rcm -= u;
        used += u;
      }
      if (p.amount - used > 0.005 && gp > 0 && gpCap > 0) {
        const u = Math.min(p.amount - used, gpCap, gp);
        gp -= u;
        gpCap -= u;
        used += u;
      }
      if (used > 0.005) {
        p.amount -= used;
        carriedUsed.push({ year: p.year, amount: round2(used), kind: 'rcm' });
      }
    }
    if (gp < -0.005) {
      pending.push({ year, amount: -gp });
      gp = 0;
    }
    if (rcm < -0.005) {
      pendingRcm.push({ year, amount: -rcm, kind: 'rcm' });
      rcm = 0;
    }
    pending = pending.filter((p) => p.amount > 0.005);
    pendingRcm = pendingRcm.filter((p) => p.amount > 0.005);

    // La retención de la venta de derechos (ganancia desde 2017) también se descuenta; solo la apuntada, sin estimar.
    const rightsWithholding = rights.filter((r) => !rcmItems.includes(r)).reduce((s, r) => s + (r.withholdingEs ?? 0), 0);
    const withholdingEs = rcmLines.reduce((s, l) => s + l.withholdingEs, 0) + rightsWithholding;
    const withholdingEsEstimated = rcmLines.filter((l) => l.estimated).reduce((s, l) => s + l.withholdingEs, 0);
    const withholdingForeign = rcmItems.reduce((s, i) => s + (i.withholdingForeign ?? 0), 0);
    const gpBase = Math.max(0, gp);
    const rcmBase = Math.max(0, rcm);
    const taxBase = gpBase + rcmBase;
    const taxEstimate = savingsTax(taxBase);
    // Doble imposición: lo retenido fuera hasta el tipo del convenio y hasta el impuesto español de esa renta
    // (al tipo medio); y la suma, sin pasar de la cuota.
    const averageRate = taxBase > 0 ? taxEstimate / taxBase : 0;
    const foreignDeduction = Math.min(
      taxEstimate,
      rcmItems.reduce(
        (s, i) =>
          s +
          Math.min(
            i.withholdingForeign ?? 0,
            Math.max(0, i.grossEur) * treatyRate(i.isin),
            Math.max(0, i.rcmEur) * averageRate,
          ),
        0,
      ),
    );
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
      carriedPending: [
        ...pending.map((p) => ({ year: p.year, amount: round2(p.amount) })),
        ...pendingRcm.map((p) => ({ year: p.year, amount: round2(p.amount), kind: 'rcm' as const })),
      ],
      gpBase,
      rcmBase,
      taxBase,
      taxEstimate,
      balanceEstimate: taxEstimate - foreignDeduction - withholdingEs,
    });
  }
  return out;
}
