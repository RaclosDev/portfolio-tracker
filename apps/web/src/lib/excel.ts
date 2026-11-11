/**
 * Exportar a Excel (.xlsx) con el aspecto del Excel de siempre: filas amarillas con orden puesta y
 * en azul los valores en otra divisa. Las librerías se cargan solo al usarlas.
 */
import { OPERATION_LABELS, type CarteraValuation, type Operation, type TaxYear, type WatchlistView } from '@watchlist/shared';
import type { Cell, Row, Sheet } from 'write-excel-file/browser';
import { parseCsv, type Cell as InCell } from './importTable.ts';

const ORDER_FILL = '#FFF2A8';
const FX_TEXT = '#1F4E9E';
const HEADER = { fontWeight: 'bold', backgroundColor: '#E7EAF0', bottomBorderStyle: 'thin', bottomBorderColor: '#9AA3B2' } as const;

const PRICE = '#,##0.00##';
const PCT = '0.0%';
const money = (cur: string) => `#,##0" ${cur === 'EUR' ? '€' : cur}"`;

const num = (v: number | null | undefined, format: string, style: object = {}): Cell =>
  v == null ? { value: undefined, ...style } : { value: v, type: Number, format, ...style };
const str = (v: string | null | undefined, style: object = {}): Cell => ({ value: v ?? undefined, type: String, ...style });
const date = (iso: string | null | undefined, style: object = {}): Cell =>
  iso ? { value: new Date(`${iso.slice(0, 10)}T00:00:00Z`), type: Date, format: 'dd/mm/yyyy', ...style } : { value: undefined, ...style };



/** Nombre de hoja válido para Excel y sin repetir. */
function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 28)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

function watchlistSheet(v: WatchlistView, name: string): Sheet<never> {
  const base = v.settings.baseCurrency;
  const header: Row = [
    'Nombre', 'Ticker', 'Bolsa', 'Divisa', 'Precio', 'Var. día',
    'Compra 1', 'Dist. 1', 'Compra 2', 'Dist. 2', 'Compra 3', 'Dist. 3', 'Estado',
    'Objetivo bróker', 'Bróker', 'Pot. bróker', 'Consenso', 'Pot. consenso', 'Analistas',
    'Importe a invertir', 'Acciones', 'Acciones fijadas', `Importe (${base})`, `Ahorro (${base})`,
    'Orden', 'Precio orden', 'Hasta', 'Notas',
  ].map((h) => ({ value: h, ...HEADER }));

  const rows: Row[] = v.rows.map(({ item, quote, targets, metrics }) => {
    const style = {
      ...(item.orderActive ? { backgroundColor: ORDER_FILL } : {}),
      ...(quote?.currency && quote.currency !== base ? { textColor: FX_TEXT } : {}),
    };
    const lvl = (i: number) => metrics.levels[i];
    return [
      str(item.name ?? quote?.name, style),
      str(item.symbol, style),
      str(quote?.exchange, style),
      str(quote?.currency, style),
      num(quote?.price, PRICE, style),
      num(quote?.changePct, PCT, style),
      num(lvl(0)?.price, PRICE, style),
      num(lvl(0)?.distancePct, PCT, style),
      num(lvl(1)?.price, PRICE, style),
      num(lvl(1)?.distancePct, PCT, style),
      num(lvl(2)?.price, PRICE, style),
      num(lvl(2)?.distancePct, PCT, style),
      str(metrics.status === 'unknown' ? null : v.settings.statusNames[metrics.status], style),
      num(item.brokerTarget, PRICE, style),
      str(item.brokerTarget ? item.brokerName : null, style),
      num(metrics.upsideBrokerPct, PCT, style),
      num(targets?.mean, PRICE, style),
      num(metrics.upsideConsensusPct, PCT, style),
      num(targets?.analysts, '0', style),
      num(metrics.investAmount, money(base), style),
      num(metrics.shares, '0', style),
      num(item.sharesOverride, '0', style),
      num(metrics.netBase, money(base), style),
      num(metrics.diffBase, money(base), style),
      str(item.orderActive ? 'Sí' : 'No', style),
      num(item.orderActive ? item.orderPrice : null, PRICE, style),
      date(item.orderActive ? item.orderUntil : null, style),
      str(item.notes, style),
    ];
  });

  const widths = [30, 11, 10, 7, 10, 9, 10, 8, 10, 8, 10, 8, 10, 12, 10, 10, 10, 11, 9, 13, 9, 11, 13, 12, 7, 11, 11, 40];
  return { sheet: name, data: [header, ...rows], columns: widths.map((width) => ({ width })), stickyRowsCount: 1, stickyColumnsCount: 2 };
}

const EUR = money('EUR');
const BOLD = { fontWeight: 'bold', topBorderStyle: 'thin', topBorderColor: '#9AA3B2' } as const;
const head = (cols: string[]): Row => cols.map((h) => ({ value: h, ...HEADER }));
const sheet = (name: string, data: Row[], widths: number[]): Sheet<never> => ({
  sheet: name,
  data,
  columns: widths.map((width) => ({ width })),
  stickyRowsCount: 1,
});

/** Hojas de la cartera: lo que hay, lo cerrado y el registro de operaciones. */
function carteraSheets(v: CarteraValuation, operations: Operation[], used: Set<string>): Sheet<never>[] {
  const open: Row[] = v.open.map((r) => [
    str(r.name),
    str(r.ticker),
    str(r.sector),
    num(r.ledger.shares, '#,##0.###'),
    num(r.price, PRICE),
    str(r.currency),
    num(r.valueEur, EUR),
    num(r.ledger.costEur, EUR),
    num(r.unrealizedEur, EUR),
    num(r.unrealizedPct, PCT),
    num(r.ledger.realizedEur, EUR),
    num(r.ledger.dividendsEur + r.ledger.otherIncomeEur, EUR),
    num(r.historicEur, EUR),
    num(r.weight, PCT),
    date(r.ledger.cycleStart),
  ]);
  const s = v.summary;
  open.push([
    str('Total', BOLD), str('', BOLD), str('', BOLD), str('', BOLD), str('', BOLD), str('', BOLD),
    num(s.valueEur, EUR, BOLD), num(s.costEur, EUR, BOLD), num(s.unrealizedEur, EUR, BOLD), str('', BOLD),
    num(s.realizedEur, EUR, BOLD), num(s.incomeEur, EUR, BOLD), num(s.totalEur, EUR, BOLD), str('', BOLD), str('', BOLD),
  ]);
  const closed: Row[] = v.closed.map((r) => [
    str(r.name),
    str(r.ticker),
    date(r.ledger.firstDate),
    date(r.ledger.lastDate),
    num(r.ledger.boughtEur, EUR),
    num(r.ledger.realizedEur, EUR),
    num(r.ledger.dividendsEur + r.ledger.otherIncomeEur, EUR),
    num(r.totalEur, EUR),
  ]);
  const ops: Row[] = [...operations]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((o) => [
      date(o.date),
      str(o.ticker),
      str(OPERATION_LABELS[o.type]),
      num(o.shares, '#,##0.###'),
      num(o.price, PRICE),
      num(o.fees || null, PRICE),
      num(o.fxRate !== 1 ? o.fxRate : null, '0.0000'),
      num(o.amountEur, EUR),
      num(o.withholdingEs, EUR),
      num(o.withholdingForeign, EUR),
      num(o.splitRatio, '0.####'),
      str(o.broker),
      str(o.notes),
      str(o.transferRef ?? null),
    ]);
  return [
    sheet(
      sheetName('Cartera', used),
      [head(['Nombre', 'Ticker', 'Sector', 'Acciones', 'Precio', 'Divisa', 'Valor', 'Coste', 'Latente', 'Latente %', 'Realizado', 'Cobros', 'Total histórico', 'Peso', 'Desde']), ...open],
      [30, 10, 16, 10, 10, 7, 13, 13, 13, 10, 13, 12, 14, 8, 11],
    ),
    sheet(
      sheetName('Cerradas', used),
      [head(['Nombre', 'Ticker', 'Primera', 'Última', 'Invertido', 'Realizado', 'Cobros', 'Total']), ...closed],
      [30, 10, 11, 11, 13, 13, 12, 13],
    ),
    sheet(
      sheetName('Registro', used),
      [head(['Fecha', 'Ticker', 'Tipo', 'Acciones', 'Precio', 'Comisiones', 'Cambio', 'Importe €', 'Ret. España', 'Ret. origen', 'Split', 'Bróker', 'Notas', 'Referencia del traspaso']), ...ops],
      [11, 10, 22, 10, 10, 11, 9, 13, 11, 11, 7, 12, 40, 28],
    ),
  ];
}

/** Descarga un .xlsx con una hoja por lista y las de la cartera. */
export async function exportExcel(views: WatchlistView[], cartera: { valuation: CarteraValuation; operations: Operation[] } | null) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const used = new Set<string>();
  const sheets: Sheet<never>[] = views.map((v) => watchlistSheet(v, sheetName(v.list.name, used)));
  if (cartera?.operations.length) sheets.push(...carteraSheets(cartera.valuation, cartera.operations, used));
  await writeXlsxFile(sheets).toFile(`watchlist-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Informe de la Renta de un año en Excel: resumen, ventas y rendimientos. */
export async function exportRenta(y: TaxYear, names: Map<string, string>) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const nm = (t: string) => names.get(t) ?? t;
  const line = (label: string, v: number | null, style: object = {}): Row => [str(label, style), num(v, EUR, style)];
  const summary: Row[] = [
    head([`Renta ${y.year}`, 'Importe']),
    line('Ganancias patrimoniales', y.gains),
    line('Pérdidas patrimoniales', y.losses),
    line('Saldo de ganancias y pérdidas', y.gpBalance, { fontWeight: 'bold' }),
    line('Rendimientos íntegros (dividendos y primas)', y.rcmGross),
    line('Gastos deducibles (comisiones)', -y.rcmFees),
    line('Saldo de rendimientos', y.rcmBalance, { fontWeight: 'bold' }),
    line('Compensación entre saldos', y.crossCompensation),
    line('Pérdidas de años anteriores compensadas', -y.carriedUsed.reduce((s, c) => s + c.amount, 0)),
    line('Base imponible del ahorro', y.taxBase, BOLD),
    line('Cuota estimada', y.taxEstimate),
    line('Retenciones en España', y.withholdingEs),
    line('  de ellas estimadas al 19 %', y.withholdingEsEstimated),
    line('Deducción por doble imposición (estimada)', y.foreignDeduction),
    line('Resultado estimado (+ a pagar / − a devolver)', y.balanceEstimate, BOLD),
    line('Informativo: pérdidas aplazadas por la regla de los dos meses', y.deferred),
    line('Informativo: pérdidas aplazadas antes que se integran (ya incluidas)', y.released),
    ...y.carriedPending.map((c) => line(`Pérdidas de ${c.year} pendientes de compensar`, c.amount)),
  ];
  const sales: Row[] = [
    head(['Valor', 'Ticker', 'Fecha venta', 'Acciones', 'Transmisión', 'Adquisición', 'Resultado', 'Aplazada', 'Computable', 'Fechas de compra']),
    ...y.sales.map((s) => [
      str(nm(s.ticker)),
      str(s.ticker),
      date(s.date),
      num(s.shares, '#,##0.###'),
      num(s.proceedsEur, EUR),
      num(s.taxCostEur, EUR),
      num(s.taxGainEur, EUR),
      num(s.deferredLossEur || null, EUR),
      num(s.computableEur, EUR),
      str([...new Set(s.matches.map((m) => m.buyDate))].join(', ')),
    ]),
    ...y.rights.map((r) => [
      str(nm(r.ticker)), str(r.ticker), date(r.date), str('Venta de derechos'), num(r.grossEur, EUR), num(r.feesEur, EUR),
      num(r.gainEur, EUR), str(''), num(r.gainEur, EUR), str(''),
    ]),
  ];
  const rcm: Row[] = [
    head(['Valor', 'Ticker', 'Fecha', 'Tipo', 'Bruto', 'Comisiones', 'Ret. España', 'Estimada', 'Ret. origen', 'Rendimiento']),
    ...y.rcmLines.map(({ item: i, withholdingEs, estimated }) => [
      str(nm(i.ticker)),
      str(i.ticker),
      date(i.date),
      str(OPERATION_LABELS[i.type]),
      num(i.grossEur, EUR),
      num(i.feesEur || null, EUR),
      num(withholdingEs, EUR),
      str(estimated ? 'Sí' : ''),
      num(i.withholdingForeign, EUR),
      num(i.rcmEur, EUR),
    ]),
  ];
  await writeXlsxFile([
    sheet('Resumen', summary, [48, 14]),
    sheet('Ganancias y pérdidas', sales, [28, 10, 12, 10, 13, 13, 13, 12, 13, 30]),
    sheet('Dividendos', rcm, [28, 10, 12, 20, 12, 11, 12, 9, 12, 13]),
  ]).toFile(`renta-${y.year}.xlsx`);
}

export interface ReadSheet {
  name: string;
  data: InCell[][];
}

/** Lee un .xlsx (todas las hojas) o un .csv/.txt (una hoja). */
export async function readSpreadsheet(file: File): Promise<ReadSheet[]> {
  if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    return [{ name: file.name.replace(/\.[^.]+$/, ''), data: parseCsv(await file.text()) }];
  }
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, data: s.data as InCell[][] }));
}
