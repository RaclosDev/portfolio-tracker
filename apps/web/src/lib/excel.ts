/**
 * Exportar a Excel (.xlsx) con el aspecto del Excel de siempre: filas amarillas con orden puesta y
 * en azul los valores en otra divisa. Las librerías se cargan solo al usarlas.
 */
import type { PortfolioView, WatchlistView } from '@watchlist/shared';
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

const STATUS = { reached: 'En zona', near: 'Cerca', far: 'Lejos', veryFar: 'Muy lejos', unknown: '' } as const;

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
      str(STATUS[metrics.status], style),
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

function portfolioSheet(p: PortfolioView, name: string): Sheet<never> {
  const base = p.settings.baseCurrency;
  const header: Row = [
    'Nombre', 'Ticker', 'Divisa', 'Acciones', 'Precio medio', 'Fecha compra', 'Precio', 'Var. día',
    `Valor (${base})`, `Invertido (${base})`, `Plusvalía (${base})`, 'Plusvalía %', `Hoy (${base})`,
    'Objetivo venta', 'Falta', 'Peso', 'Notas',
  ].map((h) => ({ value: h, ...HEADER }));
  const rows: Row[] = p.rows.map(({ position: pos, quote, metrics }) => {
    const style = quote?.currency && quote.currency !== base ? { textColor: FX_TEXT } : {};
    return [
      str(pos.name ?? quote?.name, style),
      str(pos.symbol, style),
      str(quote?.currency, style),
      num(pos.shares, '#,##0.###', style),
      num(pos.avgPrice, PRICE, style),
      date(pos.buyDate, style),
      num(quote?.price, PRICE, style),
      num(quote?.changePct, PCT, style),
      num(metrics.valueBase, money(base), style),
      num(metrics.costBase, money(base), style),
      num(metrics.pnlBase, money(base), style),
      num(metrics.pnlPct, PCT, style),
      num(metrics.dayChangeBase, money(base), style),
      num(pos.sellTarget, PRICE, style),
      num(metrics.sellDistancePct, PCT, style),
      num(metrics.weight, PCT, style),
      str(pos.notes, style),
    ];
  });
  const t = p.totals;
  const bold = { fontWeight: 'bold', topBorderStyle: 'thin', topBorderColor: '#9AA3B2' } as const;
  const total: Row = [
    str('Total', bold), str('', bold), str('', bold), str('', bold), str('', bold), str('', bold), str('', bold), str('', bold),
    num(t.valueBase, money(base), bold), num(t.costBase, money(base), bold), num(t.pnlBase, money(base), bold),
    num(t.pnlPct, PCT, bold), num(t.dayChangeBase, money(base), bold), str('', bold), str('', bold), str('', bold), str('', bold),
  ];
  const widths = [30, 11, 7, 10, 12, 12, 10, 9, 13, 13, 13, 11, 11, 13, 9, 8, 40];
  return { sheet: name, data: [header, ...rows, total], columns: widths.map((width) => ({ width })), stickyRowsCount: 1, stickyColumnsCount: 2 };
}

/** Descarga un .xlsx con una hoja por lista y otra con la cartera. */
export async function exportExcel(views: WatchlistView[], portfolio: PortfolioView | null) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const used = new Set<string>();
  const sheets: Sheet<never>[] = views.map((v) => watchlistSheet(v, sheetName(v.list.name, used)));
  if (portfolio?.rows.length) sheets.push(portfolioSheet(portfolio, sheetName('Cartera', used)));
  await writeXlsxFile(sheets).toFile(`watchlist-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
