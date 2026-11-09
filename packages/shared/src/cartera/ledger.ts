/**
 * Motor de la cartera: recorre el registro de operaciones en orden y calcula lotes, ventas (FIFO) y cobros.
 *
 * Lleva dos costes por lote:
 *  - económico (`costEur`): lo que costó de verdad. Es el que se usa para «cuánto he ganado».
 *  - fiscal (`taxCostEur`): el de Hacienda. Le restan las primas de emisión y las ventas de derechos de
 *    antes de 2017, y le suman las pérdidas aplazadas por la regla de los dos meses.
 *
 * Reglas fiscales (IRPF, España):
 *  - FIFO por valor (art. 37.2 LIRPF): se venden primero las acciones compradas antes, en cualquier bróker.
 *  - Scrip / acciones liberadas: las nuevas reparten el coste de las antiguas y conservan su antigüedad,
 *    así que se reparten entre los lotes abiertos en proporción a sus acciones.
 *  - Venta de derechos: desde 2017, ganancia patrimonial; antes, reducía el coste de las acciones.
 *  - Prima de emisión: reduce el coste fiscal hasta cero; lo que pase de cero es rendimiento del capital.
 *  - Regla de los dos meses (art. 33.5.f): una pérdida no se computa si se compran acciones del mismo
 *    valor en los dos meses anteriores o posteriores y siguen en cartera; se integra al venderlas.
 */
import { isIncome, type Operation, type OperationType } from './schemas.ts';

const EPS = 1e-6;
/** Cambio de normativa de la venta de derechos (Ley 26/2014). */
export const RIGHTS_GAIN_FROM = '2017-01-01';

export interface LotMatch {
  saleId: number;
  date: string;
  shares: number;
  costEur: number;
  proceedsEur: number;
}

export interface Lot {
  /** Id de la compra que abrió el lote. */
  id: number;
  ticker: string;
  /** Fecha de compra (antigüedad fiscal). */
  date: string;
  broker: string | null;
  /** Acciones de la compra original. */
  sharesBought: number;
  /** Coste de la compra original. */
  costBought: number;
  /** Acciones que quedan (con scrip y splits). */
  shares: number;
  costEur: number;
  taxCostEur: number;
  /** Pérdidas aplazadas por la regla de los dos meses que lleva este lote y aún no se han integrado. */
  deferredLossEur: number;
  matches: LotMatch[];
}

export interface SaleMatch {
  lotId: number;
  buyDate: string;
  shares: number;
  costEur: number;
  taxCostEur: number;
}

export interface Sale {
  id: number;
  ticker: string;
  date: string;
  year: number;
  broker: string | null;
  shares: number;
  /** Lo recibido, sin comisiones. */
  proceedsEur: number;
  costEur: number;
  /** Resultado económico. */
  gainEur: number;
  taxCostEur: number;
  /** Resultado fiscal (con el coste fiscal). */
  taxGainEur: number;
  /** Parte de la pérdida que no se puede computar este año por la regla de los dos meses (≥ 0). */
  deferredLossEur: number;
  /** Ids de las compras que aplazan la pérdida. */
  deferredBy: number[];
  /** Pérdidas aplazadas antes que se integran en esta venta (incluidas en su coste fiscal). */
  releasedLossEur: number;
  /** Lo que se declara: resultado fiscal menos la pérdida aplazada. */
  computableEur: number;
  matches: SaleMatch[];
}

export interface IncomeItem {
  id: number;
  ticker: string;
  date: string;
  year: number;
  type: OperationType;
  broker: string | null;
  grossEur: number;
  feesEur: number;
  withholdingEs: number | null;
  withholdingForeign: number | null;
  /** Lo que se gana a efectos de la rentabilidad: bruto − comisiones − retención extranjera. */
  econEur: number;
  /** Reparto fiscal del bruto menos comisiones. */
  rcmEur: number;
  gainEur: number;
  costReductionEur: number;
  source: Operation['source'];
}

export interface LedgerIssue {
  opId: number;
  ticker: string;
  date: string;
  message: string;
}

export interface TickerLedger {
  ticker: string;
  shares: number;
  costEur: number;
  taxCostEur: number;
  openLots: Lot[];
  closedLots: Lot[];
  sales: Sale[];
  income: IncomeItem[];
  /** Resultado económico de todas las ventas. */
  realizedEur: number;
  /** Dividendos y primas de asistencia (bruto − comisiones − retención extranjera). */
  dividendsEur: number;
  /** Primas de emisión y venta de derechos. */
  otherIncomeEur: number;
  /** Fecha desde la que se tiene la posición actual (null si está cerrada). */
  cycleStart: string | null;
  /** Cobros desde que se abrió la posición actual. */
  incomeSinceOpenEur: number;
  /** Acciones en cada bróker (aproximado: compras − ventas de cada uno, con scrip y splits). */
  sharesByBroker: Record<string, number>;
  /** Acciones vendidas en total. */
  soldShares: number;
  /** Lo invertido en compras en total. */
  boughtEur: number;
  firstDate: string;
  lastDate: string;
  opCount: number;
}

export interface Ledger {
  tickers: TickerLedger[];
  byTicker: Map<string, TickerLedger>;
  sales: Sale[];
  income: IncomeItem[];
  issues: LedgerIssue[];
}

/** Fecha AAAA-MM-DD ± meses (si el día no existe, el último del mes). */
export function addMonths(date: string, months: number): string {
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7) - 1 + months;
  const d = +date.slice(8, 10);
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const RANK: Record<OperationType, number> = {
  split: 0,
  buy: 1,
  scrip: 1,
  dividend: 2,
  attendance_premium: 2,
  issue_premium: 2,
  rights_sale: 2,
  sell: 3,
};

/** Orden de proceso: fecha; el mismo día, compras antes que ventas; después, orden de alta. */
export function sortOperations<T extends Pick<Operation, 'date' | 'type' | 'id'>>(ops: T[]): T[] {
  return [...ops].sort((a, b) => a.date.localeCompare(b.date) || RANK[a.type] - RANK[b.type] || a.id - b.id);
}

interface Pending {
  saleId: number;
  until: string;
  lossPerShare: number;
  sharesLeft: number;
}

interface TickerState {
  t: TickerLedger;
  pending: Pending[];
}

function newTicker(ticker: string, date: string): TickerLedger {
  return {
    ticker,
    shares: 0,
    costEur: 0,
    taxCostEur: 0,
    openLots: [],
    closedLots: [],
    sales: [],
    income: [],
    realizedEur: 0,
    dividendsEur: 0,
    otherIncomeEur: 0,
    cycleStart: null,
    incomeSinceOpenEur: 0,
    sharesByBroker: {},
    soldShares: 0,
    boughtEur: 0,
    firstDate: date,
    lastDate: date,
    opCount: 0,
  };
}

const brokerKey = (b: string | null) => b?.trim() || 'Sin bróker';
const held = (t: TickerLedger) => t.openLots.reduce((s, l) => s + l.shares, 0);

/** Reparte `amount` de coste fiscal a restar entre los lotes abiertos (hasta dejarlos a cero). Devuelve lo que sobra. */
function reduceTaxCost(t: TickerLedger, amount: number): number {
  const total = t.openLots.reduce((s, l) => s + l.taxCostEur, 0);
  if (amount <= 0 || total <= EPS) return Math.max(0, amount);
  const applied = Math.min(amount, total);
  for (const l of t.openLots) l.taxCostEur -= (applied * l.taxCostEur) / total;
  return amount - applied;
}

export function computeLedger(operations: Operation[]): Ledger {
  const states = new Map<string, TickerState>();
  const sales: Sale[] = [];
  const income: IncomeItem[] = [];
  const issues: LedgerIssue[] = [];

  // Nº del Excel de cada compra → id de su lote (para el scrip que indica a qué lote va).
  const lotBySourceRef = new Map<string, number>();
  for (const o of operations) if (o.type === 'buy' && o.sourceRef != null) lotBySourceRef.set(`${o.ticker}#${o.sourceRef}`, o.id);

  for (const op of sortOperations(operations)) {
    let st = states.get(op.ticker);
    if (!st) states.set(op.ticker, (st = { t: newTicker(op.ticker, op.date), pending: [] }));
    const t = st.t;
    t.lastDate = op.date;
    t.opCount++;
    const issue = (message: string) => issues.push({ opId: op.id, ticker: op.ticker, date: op.date, message });
    const bk = brokerKey(op.broker);
    const shares = op.shares ?? 0;

    switch (op.type) {
      case 'buy': {
        if (held(t) <= EPS) {
          t.cycleStart = op.date;
          t.incomeSinceOpenEur = 0;
        }
        const lot: Lot = {
          id: op.id,
          ticker: op.ticker,
          date: op.date,
          broker: op.broker,
          sharesBought: shares,
          costBought: op.amountEur,
          shares,
          costEur: op.amountEur,
          taxCostEur: op.amountEur,
          deferredLossEur: 0,
          matches: [],
        };
        // Regla de los dos meses (compra posterior a una venta con pérdida).
        for (const p of st.pending) {
          if (p.sharesLeft <= EPS || op.date > p.until) continue;
          const take = Math.min(p.sharesLeft, lot.shares);
          const amount = take * p.lossPerShare;
          lot.taxCostEur += amount;
          lot.deferredLossEur += amount;
          p.sharesLeft -= take;
          const sale = sales.find((s) => s.id === p.saleId)!;
          sale.deferredLossEur += amount;
          sale.computableEur = sale.taxGainEur + sale.deferredLossEur;
          sale.deferredBy.push(op.id);
        }
        t.openLots.push(lot);
        t.boughtEur += op.amountEur;
        t.sharesByBroker[bk] = (t.sharesByBroker[bk] ?? 0) + shares;
        break;
      }

      case 'scrip': {
        const total = held(t);
        if (total <= EPS) {
          t.cycleStart = op.date;
          t.incomeSinceOpenEur = 0;
          t.openLots.push({
            id: op.id,
            ticker: op.ticker,
            date: op.date,
            broker: op.broker,
            sharesBought: 0,
            costBought: 0,
            shares,
            costEur: 0,
            taxCostEur: 0,
            deferredLossEur: 0,
            matches: [],
          });
        } else {
          // Si el Excel dice de qué compra sale, todo a ese lote (conserva su antigüedad); si no, a todos en proporción.
          const target = op.lotRef != null ? t.openLots.find((l) => l.id === lotBySourceRef.get(`${op.ticker}#${op.lotRef}`)) : undefined;
          if (target) target.shares += shares;
          else for (const l of t.openLots) l.shares += (shares * l.shares) / total;
        }
        t.sharesByBroker[bk] = (t.sharesByBroker[bk] ?? 0) + shares;
        break;
      }

      case 'split': {
        const r = op.splitRatio ?? 1;
        for (const l of t.openLots) l.shares *= r;
        for (const k of Object.keys(t.sharesByBroker)) t.sharesByBroker[k]! *= r;
        for (const p of st.pending) {
          p.sharesLeft *= r;
          p.lossPerShare /= r;
        }
        break;
      }

      case 'sell': {
        const available = held(t);
        let want = shares;
        if (want > available + EPS) {
          issue(`Se venden ${fmt(want)} acciones pero solo hay ${fmt(available)}.`);
          want = available;
        }
        const sale: Sale = {
          id: op.id,
          ticker: op.ticker,
          date: op.date,
          year: +op.date.slice(0, 4),
          broker: op.broker,
          shares,
          proceedsEur: op.amountEur,
          costEur: 0,
          gainEur: 0,
          taxCostEur: 0,
          taxGainEur: 0,
          deferredLossEur: 0,
          deferredBy: [],
          releasedLossEur: 0,
          computableEur: 0,
          matches: [],
        };
        let left = want;
        while (left > EPS && t.openLots.length) {
          const lot = t.openLots[0]!;
          const take = Math.min(left, lot.shares);
          const f = take / lot.shares;
          const cost = lot.costEur * f;
          const taxCost = lot.taxCostEur * f;
          const released = lot.deferredLossEur * f;
          sale.costEur += cost;
          sale.taxCostEur += taxCost;
          sale.releasedLossEur += released;
          sale.matches.push({ lotId: lot.id, buyDate: lot.date, shares: take, costEur: cost, taxCostEur: taxCost });
          lot.matches.push({ saleId: op.id, date: op.date, shares: take, costEur: cost, proceedsEur: want ? (op.amountEur * take) / want : 0 });
          lot.shares -= take;
          lot.costEur -= cost;
          lot.taxCostEur -= taxCost;
          lot.deferredLossEur -= released;
          left -= take;
          if (lot.shares <= EPS) {
            lot.shares = 0;
            t.closedLots.push(t.openLots.shift()!);
          }
        }
        sale.gainEur = sale.proceedsEur - sale.costEur;
        sale.taxGainEur = sale.proceedsEur - sale.taxCostEur;
        sale.computableEur = sale.taxGainEur;
        // Regla de los dos meses: compras del mismo valor en los dos meses anteriores que siguen en cartera…
        if (sale.taxGainEur < -0.005 && want > EPS) {
          const lossPerShare = -sale.taxGainEur / want;
          let unassigned = want;
          const from = addMonths(op.date, -2);
          for (const lot of t.openLots) {
            if (unassigned <= EPS) break;
            if (lot.date < from || lot.sharesBought <= 0) continue;
            const take = Math.min(unassigned, lot.shares);
            const amount = take * lossPerShare;
            lot.taxCostEur += amount;
            lot.deferredLossEur += amount;
            sale.deferredLossEur += amount;
            sale.deferredBy.push(lot.id);
            unassigned -= take;
          }
          sale.computableEur = sale.taxGainEur + sale.deferredLossEur;
          // …y las que se compren en los dos meses siguientes.
          if (unassigned > EPS) st.pending.push({ saleId: op.id, until: addMonths(op.date, 2), lossPerShare, sharesLeft: unassigned });
        }
        t.realizedEur += sale.gainEur;
        t.soldShares += want;
        t.sharesByBroker[bk] = (t.sharesByBroker[bk] ?? 0) - want;
        t.sales.push(sale);
        sales.push(sale);
        break;
      }

      default: {
        if (!isIncome(op.type)) break;
        const fx = op.fxRate || 1;
        const feesEur = op.fees / fx;
        const base = op.amountEur - feesEur;
        const item: IncomeItem = {
          id: op.id,
          ticker: op.ticker,
          date: op.date,
          year: +op.date.slice(0, 4),
          type: op.type,
          broker: op.broker,
          grossEur: op.amountEur,
          feesEur,
          withholdingEs: op.withholdingEs,
          withholdingForeign: op.withholdingForeign,
          econEur: base - (op.withholdingForeign ?? 0),
          rcmEur: 0,
          gainEur: 0,
          costReductionEur: 0,
          source: op.source,
        };
        if (op.type === 'dividend' || op.type === 'attendance_premium') {
          item.rcmEur = base;
          t.dividendsEur += item.econEur;
        } else if (op.type === 'issue_premium') {
          const excess = reduceTaxCost(t, base);
          item.costReductionEur = base - excess;
          item.rcmEur = excess;
          t.otherIncomeEur += item.econEur;
        } else if (op.type === 'rights_sale') {
          if (op.date >= RIGHTS_GAIN_FROM || base < 0) item.gainEur = base;
          else {
            const excess = reduceTaxCost(t, base);
            item.costReductionEur = base - excess;
            item.gainEur = excess;
          }
          t.otherIncomeEur += item.econEur;
        }
        t.incomeSinceOpenEur += item.econEur;
        t.income.push(item);
        income.push(item);
      }
    }
  }

  const tickers = [...states.values()].map(({ t }) => {
    t.shares = held(t);
    if (t.shares <= EPS) {
      t.shares = 0;
      t.cycleStart = null;
    }
    t.costEur = t.openLots.reduce((s, l) => s + l.costEur, 0);
    t.taxCostEur = t.openLots.reduce((s, l) => s + l.taxCostEur, 0);
    for (const k of Object.keys(t.sharesByBroker)) if (Math.abs(t.sharesByBroker[k]!) < EPS) delete t.sharesByBroker[k];
    return t;
  });
  return { tickers, byTicker: new Map(tickers.map((t) => [t.ticker, t])), sales, income, issues };
}

const fmt = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 4 });
