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
 *
 * Identidad del valor: el ISIN. Los tickers con el mismo ISIN (un ETF comprado en dos bolsas) forman una
 * sola posición, con un único FIFO y una única regla de los dos meses. Se agrupa al calcular, sin tocar el
 * registro: cada operación y cada lote conservan su ticker (el del extracto del bróker), que solo sirve para
 * pedir la cotización.
 */
import { isIncome, type Instrument, type Operation, type OperationType } from './schemas.ts';
import { cents, splitCents } from './money.ts';

const EPS = 1e-6;
/** Parte de un importe del lote: entero si se toma todo, si no en céntimos (los importes se guardan con céntimos). */
const portion = (amount: number, f: number, whole: boolean) => (whole ? amount : cents(amount * f));
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
  /** Id de la compra; negativo para fragmentos procedentes de un traspaso. */
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
  /**
   * Coste en la divisa del valor al cambio de cada compra (para el precio medio en esa divisa).
   * null si la compra no lo permite saber (sin cambio ni precio): entonces se usa el cambio de hoy.
   */
  costNative: number | null;
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
  /** Ticker de la posición: el canónico de su ISIN (ver `identityByTicker`) o el suyo si no tiene ISIN. */
  ticker: string;
  /** ISIN que agrupa la posición (null si el valor no lo tiene). */
  isin: string | null;
  /** Tickers del registro que forman la posición (más de uno si el mismo ISIN cotiza en varias bolsas). */
  members: string[];
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
  cashFlows: { date: string; amount: number }[];
  inTransitEur: number;
  inTransitCostEur: number;
  tickers: TickerLedger[];
  /** Posición de cada ticker, también de los que se agrupan en otro por compartir ISIN. */
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
  transfer_out: 4,
  transfer_in: 5,
};

/**
 * Orden de proceso: fecha; el mismo día, primero las que tienen «orden del día» (1, 2, 3…) y en ese orden;
 * después las que no lo tienen: compras antes que ventas y, a igualdad, por orden de alta.
 */
export function sortOperations<T extends Pick<Operation, 'date' | 'type' | 'id'> & { dayOrder?: number | null }>(ops: T[]): T[] {
  const ord = (o: T) => o.dayOrder ?? Number.POSITIVE_INFINITY;
  return [...ops].sort(
    (a, b) => a.date.localeCompare(b.date) || (ord(a) === ord(b) ? 0 : ord(a) < ord(b) ? -1 : 1) || RANK[a.type] - RANK[b.type] || a.id - b.id,
  );
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

function newTicker(ticker: string, isin: string | null, date: string): TickerLedger {
  return {
    ticker,
    isin,
    members: [],
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

/**
 * Coste de una compra en la divisa del valor: con el cambio del día de la compra o, si no se indicó
 * (cambio 1 en un valor extranjero importado), con su precio y comisiones. null si no se puede saber.
 */
function nativeCost(op: Operation): number | null {
  if (op.fxRate !== 1) return op.amountEur * op.fxRate;
  if (op.price != null && op.shares) return op.shares * op.price + op.fees;
  return null;
}

/**
 * Precio medio de las acciones que quedan, en la divisa del valor y con el cambio de cada compra.
 * `fxToday` (unidades por 1 €) solo se usa para los lotes cuyo coste en divisa no se conoce.
 */
export function averageNativePrice(t: Pick<TickerLedger, 'openLots'>, currency: string, fxToday: number | null): number | null {
  const shares = t.openLots.reduce((s, l) => s + l.shares, 0);
  if (shares <= EPS) return null;
  if (currency === 'EUR') return t.openLots.reduce((s, l) => s + l.costEur, 0) / shares;
  let native = 0;
  for (const l of t.openLots) {
    if (l.costNative != null) native += l.costNative;
    else if (fxToday) native += l.costEur * fxToday;
    else return null;
  }
  return native / shares;
}

const brokerKey = (b: string | null) => b?.trim() || 'Sin bróker';
const held = (t: TickerLedger) => t.openLots.reduce((s, l) => s + l.shares, 0);

/** Reparte `amount` de coste fiscal a restar entre los lotes abiertos (hasta dejarlos a cero). Devuelve lo que sobra. */
function reduceTaxCost(t: TickerLedger, amount: number): number {
  const total = t.openLots.reduce((s, l) => s + l.taxCostEur, 0);
  if (amount <= 0 || total <= EPS) return Math.max(0, amount);
  const applied = Math.min(amount, total);
  const parts = splitCents(applied, t.openLots.map((l) => l.taxCostEur / total));
  t.openLots.forEach((l, i) => (l.taxCostEur = cents(l.taxCostEur - parts[i]!)));
  return cents(amount - applied);
}

const normIsin = (isin: string | null | undefined) => {
  const v = isin?.trim().toUpperCase();
  return v && v.length === 12 ? v : null;
};

/**
 * Ticker canónico de cada ticker con ISIN: el mismo para todos los que comparten ISIN. Se prefiere el que
 * tiene símbolo de Yahoo y, a igualdad, el primero por orden alfabético (estable entre cálculos).
 * Los tickers sin ISIN no aparecen: son su propia posición.
 */
export function identityByTicker(instruments: readonly Pick<Instrument, 'ticker' | 'symbol' | 'isin'>[]): Map<string, { key: string; isin: string }> {
  const groups = new Map<string, Pick<Instrument, 'ticker' | 'symbol'>[]>();
  for (const i of instruments) {
    const isin = normIsin(i.isin);
    if (isin) groups.set(isin, [...(groups.get(isin) ?? []), i]);
  }
  const out = new Map<string, { key: string; isin: string }>();
  for (const [isin, list] of groups) {
    const key = [...list].sort((a, b) => Number(!a.symbol) - Number(!b.symbol) || a.ticker.localeCompare(b.ticker))[0]!.ticker;
    for (const i of list) out.set(i.ticker, { key, isin });
  }
  return out;
}

/** `instruments` da el ISIN de cada ticker: sin él (o sin ISIN), cada ticker es una posición aparte. */
export function computeLedger(operations: Operation[], instruments: readonly Pick<Instrument, 'ticker' | 'symbol' | 'isin'>[] = []): Ledger {
  const identity = identityByTicker(instruments);
  const keyOf = (ticker: string) => identity.get(ticker)?.key ?? ticker;
  const states = new Map<string, TickerState>();
  const sales: Sale[] = [];
  const income: IncomeItem[] = [];
  const issues: LedgerIssue[] = [];
  const transfers = new Map<string, { operation: Operation; lots: Lot[]; received: boolean }>();
  let transferredLotId = 0;
  // Acciones de cada lote que ya sirven de recompra para aplazar una pérdida: no pueden aplazar otra.
  const washUsed = new Map<Lot, number>();
  const washFree = (lot: Lot) => lot.shares - (washUsed.get(lot) ?? 0);

  // Nº del Excel de cada compra → id de su lote (para el scrip que indica a qué lote va).
  const lotBySourceRef = new Map<string, number>();
  for (const o of operations) if (o.type === 'buy' && o.sourceRef != null) lotBySourceRef.set(`${o.ticker}#${o.sourceRef}`, o.id);

  for (const op of sortOperations(operations)) {
    const key = keyOf(op.ticker);
    let st = states.get(key);
    if (!st) states.set(key, (st = { t: newTicker(key, identity.get(op.ticker)?.isin ?? null, op.date), pending: [] }));
    const t = st.t;
    if (!t.members.includes(op.ticker)) t.members.push(op.ticker);
    t.lastDate = op.date;
    t.opCount++;
    const issue = (message: string) => issues.push({ opId: op.id, ticker: op.ticker, date: op.date, message });
    const bk = brokerKey(op.broker);
    const shares = op.shares ?? 0;

    switch (op.type) {
      case 'transfer_out': {
        if (!op.transferRef || transfers.has(op.transferRef)) {
          issue('La salida necesita una referencia de traspaso única.');
          break;
        }
        if (shares > held(t) + EPS) {
          issue('El traspaso supera las participaciones disponibles.');
          break;
        }
        const moved: Lot[] = [];
        let left = shares;
        while (left > EPS && t.openLots.length) {
          const lot = t.openLots[0]!;
          const take = Math.min(left, lot.shares);
          const fraction = take / lot.shares;
          const whole = take >= lot.shares - EPS;
          const costEur = portion(lot.costEur, fraction, whole);
          const part: Lot = { ...lot, id: --transferredLotId, shares: take, sharesBought: take,
            costBought: costEur, costEur, costNative: null,
            taxCostEur: portion(lot.taxCostEur, fraction, whole), deferredLossEur: portion(lot.deferredLossEur, fraction, whole), matches: [] };
          moved.push(part);
          lot.shares -= take;
          lot.costEur = cents(lot.costEur - part.costEur);
          if (lot.costNative != null) lot.costNative *= 1 - fraction;
          lot.taxCostEur = cents(lot.taxCostEur - part.taxCostEur);
          lot.deferredLossEur = cents(lot.deferredLossEur - part.deferredLossEur);
          left -= take;
          if (lot.shares <= EPS) {
            lot.shares = 0;
            t.closedLots.push(t.openLots.shift()!);
          }
        }
        transfers.set(op.transferRef, { operation: op, lots: moved, received: false });
        t.sharesByBroker[bk] = (t.sharesByBroker[bk] ?? 0) - shares;
        break;
      }
      case 'transfer_in': {
        const transfer = op.transferRef ? transfers.get(op.transferRef) : undefined;
        if (!transfer || transfer.received) {
          issue('Falta una salida anterior disponible con la misma referencia de traspaso.');
          break;
        }
        if (keyOf(transfer.operation.ticker) === key || Math.abs(transfer.operation.amountEur - op.amountEur) > 0.005) {
          issue('El traspaso debe enlazar fondos distintos con el mismo importe.');
          break;
        }
        if (held(t) <= EPS) {
          t.cycleStart = op.date;
          t.incomeSinceOpenEur = 0;
        }
        const total = transfer.lots.reduce((sum, lot) => sum + lot.shares, 0);
        for (const lot of transfer.lots) {
          const quantity = shares * lot.shares / total;
          t.openLots.push({ ...lot, ticker: op.ticker, broker: op.broker, shares: quantity, sharesBought: quantity,
            costNative: op.fxRate !== 1 ? lot.costEur * op.fxRate : null });
        }
        // La antigüedad de los lotes traspasados decide el FIFO de futuras ventas.
        t.openLots.sort((a, b) => a.date.localeCompare(b.date));
        t.sharesByBroker[bk] = (t.sharesByBroker[bk] ?? 0) + shares;
        transfer.received = true;
        break;
      }
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
          costNative: nativeCost(op),
          taxCostEur: op.amountEur,
          deferredLossEur: 0,
          matches: [],
        };
        // Regla de los dos meses (compra posterior a una venta con pérdida).
        let room = lot.shares;
        for (const p of st.pending) {
          if (room <= EPS) break;
          if (p.sharesLeft <= EPS || op.date > p.until) continue;
          const take = Math.min(p.sharesLeft, room);
          room -= take;
          const amount = cents(take * p.lossPerShare);
          lot.taxCostEur += amount;
          lot.deferredLossEur += amount;
          p.sharesLeft -= take;
          const sale = sales.find((s) => s.id === p.saleId)!;
          sale.deferredLossEur = cents(sale.deferredLossEur + amount);
          sale.computableEur = cents(sale.taxGainEur + sale.deferredLossEur);
          sale.deferredBy.push(op.id);
        }
        if (room < lot.shares - EPS) washUsed.set(lot, lot.shares - room);
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
            costNative: 0,
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
        for (const l of t.openLots) {
          l.shares *= r;
          const used = washUsed.get(l);
          if (used) washUsed.set(l, used * r);
        }
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
          const whole = take >= lot.shares - EPS;
          const cost = portion(lot.costEur, f, whole);
          const taxCost = portion(lot.taxCostEur, f, whole);
          const released = portion(lot.deferredLossEur, f, whole);
          sale.costEur += cost;
          sale.taxCostEur += taxCost;
          sale.releasedLossEur += released;
          sale.matches.push({ lotId: lot.id, buyDate: lot.date, shares: take, costEur: cost, taxCostEur: taxCost });
          lot.matches.push({ saleId: op.id, date: op.date, shares: take, costEur: cost, proceedsEur: want ? cents((op.amountEur * take) / want) : 0 });
          const used = washUsed.get(lot);
          if (used) washUsed.set(lot, used * (1 - f));
          lot.shares -= take;
          lot.costEur = cents(lot.costEur - cost);
          if (lot.costNative != null) lot.costNative *= 1 - f;
          lot.taxCostEur = cents(lot.taxCostEur - taxCost);
          lot.deferredLossEur = cents(lot.deferredLossEur - released);
          left -= take;
          if (lot.shares <= EPS) {
            lot.shares = 0;
            t.closedLots.push(t.openLots.shift()!);
          }
        }
        sale.costEur = cents(sale.costEur);
        sale.taxCostEur = cents(sale.taxCostEur);
        sale.releasedLossEur = cents(sale.releasedLossEur);
        sale.gainEur = cents(sale.proceedsEur - sale.costEur);
        sale.taxGainEur = cents(sale.proceedsEur - sale.taxCostEur);
        sale.computableEur = sale.taxGainEur;
        // Regla de los dos meses: compras del mismo valor en los dos meses anteriores que siguen en cartera…
        if (sale.taxGainEur < -0.005 && want > EPS) {
          const lossPerShare = -sale.taxGainEur / want;
          let unassigned = want;
          const from = addMonths(op.date, -2);
          for (const lot of t.openLots) {
            if (unassigned <= EPS) break;
            if (lot.date < from || lot.sharesBought <= 0) continue;
            const take = Math.min(unassigned, washFree(lot));
            if (take <= EPS) continue;
            washUsed.set(lot, (washUsed.get(lot) ?? 0) + take);
            const amount = cents(take * lossPerShare);
            lot.taxCostEur += amount;
            lot.deferredLossEur += amount;
            sale.deferredLossEur += amount;
            sale.deferredBy.push(lot.id);
            unassigned -= take;
          }
          sale.deferredLossEur = cents(sale.deferredLossEur);
          sale.computableEur = cents(sale.taxGainEur + sale.deferredLossEur);
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
        const feesEur = cents(op.fees / fx);
        const base = cents(op.amountEur - feesEur);
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
          econEur: cents(base - (op.withholdingForeign ?? 0)),
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
          item.costReductionEur = cents(base - excess);
          item.rcmEur = excess;
          t.otherIncomeEur += item.econEur;
        } else if (op.type === 'rights_sale') {
          if (op.date >= RIGHTS_GAIN_FROM || base < 0) item.gainEur = base;
          else {
            const excess = reduceTaxCost(t, base);
            item.costReductionEur = cents(base - excess);
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
    t.costEur = cents(t.openLots.reduce((s, l) => s + l.costEur, 0));
    t.taxCostEur = cents(t.openLots.reduce((s, l) => s + l.taxCostEur, 0));
    // Sumas de importes con céntimos: sin el ruido de la coma flotante.
    for (const k of ['boughtEur', 'realizedEur', 'dividendsEur', 'otherIncomeEur', 'incomeSinceOpenEur'] as const) t[k] = cents(t[k]);
    for (const k of Object.keys(t.sharesByBroker)) if (Math.abs(t.sharesByBroker[k]!) < EPS) delete t.sharesByBroker[k];
    t.members.sort();
    return t;
  });
  const pending = [...transfers.values()].filter((transfer) => !transfer.received);
  const cashFlows = operations.filter((o) => o.type === 'buy' || o.type === 'sell')
    .map((o) => ({ date: o.date, amount: o.type === 'buy' ? -o.amountEur : o.amountEur }));
  cashFlows.push(...income.map((i) => ({ date: i.date, amount: i.econEur })));
  const byTicker = new Map(tickers.flatMap((t) => [[t.ticker, t] as const, ...t.members.map((m) => [m, t] as const)]));
  return { tickers, byTicker, sales, income, issues, cashFlows,
    inTransitEur: cents(pending.reduce((sum, transfer) => sum + transfer.operation.amountEur, 0)),
    inTransitCostEur: cents(pending.reduce((sum, transfer) => sum + transfer.lots.reduce((n, lot) => n + lot.costEur, 0), 0)) };
}

const fmt = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 4 });
