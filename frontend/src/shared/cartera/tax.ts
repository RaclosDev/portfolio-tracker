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
import { addMonths, type IncomeItem, type Ledger, type Sale } from './ledger.ts';

/** Retención española general sobre dividendos y demás RCM. */
export const ES_WITHHOLDING_RATE = 0.19;
/** Desde este año, los dividendos importados sin retención se estiman al 19 % (la Renta de esos años está pendiente). */
export const ESTIMATE_WITHHOLDING_FROM = 2026;

/**
 * Bróker o banco depositario con sede en España: retiene el 19 % al pagar el dividendo a un residente. Un bróker
 * extranjero (Interactive Brokers, Degiro, Trade Republic…) no retiene en España, y el cliente lo declara y lo
 * paga él. Solo se estima retención si el bróker apuntado es uno de estos; sin bróker o con otro, no se estima
 * (la opción prudente: la cuota a pagar no sale menor de lo real).
 */
const ES_WITHHOLDING_BROKERS = [
  'ing', 'myinvestor', 'renta 4', 'bankinter', 'santander', 'bbva', 'caixabank', 'openbank', 'selfbank', 'self bank',
  'inversis', 'andbank', 'abanca', 'sabadell', 'kutxabank', 'ibercaja', 'unicaja', 'cajamar', 'cecabank', 'bankia',
  'banco mediolanum', 'arquia', 'laboral kutxa', 'cajasur', 'targobank',
];

const normalizeBroker = (broker: string) =>
  broker.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** ¿El bróker apuntado es un depositario español que retiene el 19 %? */
export function brokerWithholdsInSpain(broker: string | null | undefined): boolean {
  if (!broker) return false;
  const name = ` ${normalizeBroker(broker)} `;
  return ES_WITHHOLDING_BROKERS.some((b) => name.includes(` ${b} `));
}

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

export interface SavingsBracket {
  upTo: number;
  rate: number;
}

/**
 * Escala de la base del ahorro (estatal + autonómica, tipos medios de la escala general) por ejercicio. Cada
 * entrada vale desde su año hasta la siguiente. Fuente: art. 66 y 76 de la Ley 35/2006 (LIRPF) y sus reformas
 * (RDL 20/2011, Ley 16/2012, Ley 26/2014, RDL 3/2016, Ley 31/2022, Ley 7/2024).
 *
 *  - 2007–2009: 18 % fijo.   - 2010–2011: 19 % hasta 6.000 €, 21 % el resto.
 *  - 2012–2014: 21 % hasta 6.000 €, 25 % hasta 24.000 €, 27 % el resto (con el recargo de solidaridad de 2012–2014).
 *  - 2015: 19,5 / 21,5 / 23,5 % (6.000 / 50.000 €).   - 2016–2020: 19 / 21 / 23 %.
 *  - 2021–2022: se añade el 26 % desde 200.000 €.   - 2023–2024: 27 % hasta 300.000 €, 28 % más allá.
 *  - 2025 en adelante: 19 / 21 / 23 / 27 / 30 % (tramos en 6.000 / 50.000 / 200.000 / 300.000 €).
 * Antes de 2007 (régimen anterior) no se modela: se usa la escala de 2007. Un año posterior al último de la
 * tabla usa la última.
 */
export const SAVINGS_SCALES: readonly { from: number; brackets: readonly SavingsBracket[] }[] = [
  { from: 2007, brackets: [{ upTo: Infinity, rate: 0.18 }] },
  { from: 2010, brackets: [{ upTo: 6_000, rate: 0.19 }, { upTo: Infinity, rate: 0.21 }] },
  { from: 2012, brackets: [{ upTo: 6_000, rate: 0.21 }, { upTo: 24_000, rate: 0.25 }, { upTo: Infinity, rate: 0.27 }] },
  { from: 2015, brackets: [{ upTo: 6_000, rate: 0.195 }, { upTo: 50_000, rate: 0.215 }, { upTo: Infinity, rate: 0.235 }] },
  { from: 2016, brackets: [{ upTo: 6_000, rate: 0.19 }, { upTo: 50_000, rate: 0.21 }, { upTo: Infinity, rate: 0.23 }] },
  { from: 2021, brackets: [{ upTo: 6_000, rate: 0.19 }, { upTo: 50_000, rate: 0.21 }, { upTo: 200_000, rate: 0.23 }, { upTo: Infinity, rate: 0.26 }] },
  { from: 2023, brackets: [{ upTo: 6_000, rate: 0.19 }, { upTo: 50_000, rate: 0.21 }, { upTo: 200_000, rate: 0.23 }, { upTo: 300_000, rate: 0.27 }, { upTo: Infinity, rate: 0.28 }] },
  { from: 2025, brackets: [{ upTo: 6_000, rate: 0.19 }, { upTo: 50_000, rate: 0.21 }, { upTo: 200_000, rate: 0.23 }, { upTo: 300_000, rate: 0.27 }, { upTo: Infinity, rate: 0.3 }] },
];

/** Escala del ahorro vigente en un año. */
export function savingsBrackets(year: number): readonly SavingsBracket[] {
  let found = SAVINGS_SCALES[0]!;
  for (const scale of SAVINGS_SCALES) if (scale.from <= year) found = scale;
  return found.brackets;
}

/** Escala del ahorro vigente desde 2025. */
export const SAVINGS_BRACKETS: readonly SavingsBracket[] = savingsBrackets(2025);

/** Años en que las ganancias de un año o menos de antigüedad iban a la base general (Ley 16/2012; derogado en 2015). */
export function shortTermGoesToGeneralBase(year: number) {
  return year === 2013 || year === 2014;
}

/** Porcentaje de compensación cruzada entre ganancias y RCM según el año. */
export function crossCompensationPct(year: number) {
  if (year <= 2014) return 0;
  if (year === 2015) return 0.1;
  if (year === 2016) return 0.15;
  if (year === 2017) return 0.2;
  return 0.25;
}

/** Cuota de la base del ahorro de un año (por defecto, la escala actual). */
export function savingsTax(base: number, year = 2025): number {
  let tax = 0;
  let prev = 0;
  for (const b of savingsBrackets(year)) {
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
  /**
   * Resultado de las ventas de un año o menos de antigüedad, que en 2013 y 2014 va a la base general y no a la
   * del ahorro (0 en los demás años). No entra en `gains`, `losses` ni `gpBalance`, y no se estima su cuota
   * (depende del resto de rentas); un saldo negativo tampoco se compensa ni se arrastra, que es lo prudente.
   */
  shortTermBalance: number;
  /** Pérdidas de este año aplazadas por la regla de recompra. */
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
  if (item.source === 'excel' && item.year >= ESTIMATE_WITHHOLDING_FROM && item.rcmEur > 0 && brokerWithholdsInSpain(item.broker))
    return { value: round2(item.rcmEur * ES_WITHHOLDING_RATE), estimated: true };
  return { value: 0, estimated: false };
}

/**
 * Parte de lo declarable de una venta que corresponde a lotes con un año o menos de antigüedad (para la base
 * general en 2013 y 2014). El resultado de cada tramo es lo cobrado en proporción a sus acciones menos su coste
 * fiscal; la pérdida aplazada se reparte por acciones.
 */
export function shortTermPart(sale: Sale): number {
  const total = sale.matches.reduce((s, m) => s + m.shares, 0);
  if (total <= 0) return 0;
  let part = 0;
  for (const m of sale.matches) {
    if (sale.date > addMonths(m.buyDate, 12)) continue;
    const share = m.shares / total;
    part += sale.proceedsEur * share - m.taxCostEur + sale.deferredLossEur * share;
  }
  return round2(part);
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

    // En 2013 y 2014 el resultado de lo vendido con un año o menos va a la base general, no a la del ahorro.
    const shortParts = shortTermGoesToGeneralBase(year) ? sales.map(shortTermPart) : sales.map(() => 0);
    const shortTermBalance = round2(shortParts.reduce((a, b) => a + b, 0));
    const gpValues = [...sales.map((s, i) => s.computableEur - shortParts[i]!), ...rights.map((r) => r.gainEur)];
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
    const taxEstimate = savingsTax(taxBase, year);
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
      shortTermBalance,
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
