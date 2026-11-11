/**
 * Lectura de tablas de Excel o CSV: reconoce las columnas por su título (el Excel de siempre,
 * el que exporta esta app u otros parecidos) y convierte cada fila en un valor para importar.
 * Funciones puras: no leen ficheros ni llaman a la API.
 */
import type { ImportRow } from '@watchlist/shared';
import { parseDecimal } from './format.ts';

export type Cell = string | number | boolean | Date | null | undefined;

export type Field =
  | 'symbol'
  | 'name'
  | 'buy1'
  | 'buy2'
  | 'buy3'
  | 'brokerTarget'
  | 'brokerName'
  | 'investAmount'
  | 'sharesOverride'
  | 'orderActive'
  | 'orderPrice'
  | 'orderUntil'
  | 'notes';

export const FIELD_LABEL: Record<Field, string> = {
  symbol: 'Ticker',
  name: 'Nombre',
  buy1: 'Compra 1',
  buy2: 'Compra 2',
  buy3: 'Compra 3',
  brokerTarget: 'Objetivo bróker',
  brokerName: 'Bróker',
  investAmount: 'Importe a invertir',
  sharesOverride: 'Acciones fijadas',
  orderActive: 'Orden',
  orderPrice: 'Precio orden',
  orderUntil: 'Orden hasta',
  notes: 'Notas',
};

/** Minúsculas, sin acentos ni signos: «P.O. R4» → «p o r4», «Invertir €» → «invertir». */
export const normalize = (h: unknown) =>
  String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const RULES: [Field, RegExp][] = [
  ['symbol', /^(ticker|simbolo|symbol|codigo|isin)$/],
  ['name', /^(accion|acciones nombre|nombre|valor|empresa|compania|name)$/],
  ['buy1', /^(p|precio)? ?(de )?com(pra)? ?1$/],
  ['buy2', /^(p|precio)? ?(de )?com(pra)? ?2$/],
  ['buy3', /^(p|precio)? ?(de )?com(pra)? ?3$/],
  ['brokerTarget', /^(p o|po|precio objetivo|objetivo)( broker| [a-z0-9]+)?$/],
  ['brokerName', /^broker$/],
  ['investAmount', /^(importe a invertir|a invertir|invertir|importe invertir)$/],
  ['sharesOverride', /^(acc compr|acciones fijadas|acc fijadas|acciones a comprar)$/],
  ['orderActive', /^(orden|orden activa)$/],
  ['orderPrice', /^(precio (de )?orden|orden precio|precio limite)$/],
  ['orderUntil', /^(hasta|valida hasta|orden hasta|vencimiento|caducidad)$/],
  ['notes', /^(notas?|observaciones|comentarios)$/],
];

/** Qué columna corresponde a cada campo (la primera que encaje). */
export function detectColumns(header: Cell[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const n = normalize(h);
    if (!n) return;
    const rule = RULES.find(([field, re]) => out[field] == null && re.test(n));
    if (rule) out[rule[0]] = i;
  });
  return out;
}

/** Nombre del bróker implícito en el título («P.O. R4» → Renta 4). */
function brokerFromHeader(h: Cell): string | null {
  const m = normalize(h).match(/^(?:p o|po|precio objetivo|objetivo) ([a-z0-9]+)$/);
  if (!m || m[1] === 'broker') return null;
  return m[1] === 'r4' ? 'Renta 4' : m[1]!.toUpperCase();
}

const isError = (v: Cell) => typeof v === 'string' && /^#(VALUE|N\/A|DIV\/0|REF|NAME|NUM|NULL)/i.test(v.trim());

const text = (v: Cell): string | null => {
  if (v == null || isError(v)) return null;
  const s = String(v).trim();
  return s || null;
};

const number = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = text(v);
  return s ? parseDecimal(s.replace(/[€$£\s]/g, '')) : null;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha AAAA-MM-DD desde una celda de fecha, un número de serie de Excel o un texto dd/mm/aaaa. */
export function toIsoDate(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Las fechas de Excel llegan a medianoche UTC.
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) return toIsoDate(new Date(Math.round((v - 25569) * 86_400_000)));
  const s = text(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2]!)}-${pad(+m[3]!)}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return `${y}-${pad(+m[2]!)}-${pad(+m[1]!)}`;
  }
  return null;
}

const yes = (v: Cell) => {
  if (typeof v === 'boolean') return v;
  const n = normalize(v);
  return ['si', 's', 'x', 'yes', 'true', '1', 'activa', 'activo'].includes(n);
};

export interface ParsedTable {
  /** Columnas reconocidas (para enseñarlas antes de importar). */
  columns: Partial<Record<Field, number>>;
  headerRow: number;
  rows: ImportRow[];
  /** Filas descartadas: sin ticker o duplicadas. */
  skipped: number;
}

/**
 * Busca la fila de títulos (la primera, entre las 15 primeras, que tenga columna de ticker) y
 * convierte las filas siguientes. Las celdas vacías no se envían: así no se borra nada al importar.
 */
export function parseTable(data: Cell[][]): ParsedTable | null {
  const headerRow = data.slice(0, 15).findIndex((r) => detectColumns(r).symbol != null);
  if (headerRow < 0) return null;
  const header = data[headerRow]!;
  const columns = detectColumns(header);
  const impliedBroker = columns.brokerTarget != null ? brokerFromHeader(header[columns.brokerTarget]) : null;
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  let skipped = 0;

  for (const r of data.slice(headerRow + 1)) {
    const get = (f: Field) => (columns[f] == null ? undefined : r[columns[f]!]);
    const symbol = text(get('symbol'))?.toUpperCase().replace(/\s+/g, ' ');
    if (!symbol) {
      if (r.some((c) => text(c))) skipped++;
      continue;
    }
    if (seen.has(symbol)) {
      skipped++;
      continue;
    }
    seen.add(symbol);

    const row: ImportRow = { symbol };
    const name = text(get('name'));
    if (name) row.name = name;
    const buys = (['buy1', 'buy2', 'buy3'] as const).map((f) => number(get(f))).filter((n): n is number => n != null && n > 0);
    if (buys.length) row.buyPrices = buys;
    const target = number(get('brokerTarget'));
    if (target && target > 0) {
      row.brokerTarget = target;
      const broker = text(get('brokerName')) ?? impliedBroker;
      if (broker) row.brokerName = broker;
    }
    const invest = number(get('investAmount'));
    if (invest && invest > 0) row.investAmount = invest;
    const shares = number(get('sharesOverride'));
    if (shares && shares > 0) row.sharesOverride = Math.round(shares);
    const until = toIsoDate(get('orderUntil'));
    const orderPrice = number(get('orderPrice'));
    // Una fecha «hasta» o un precio de orden implican orden puesta (en el Excel eran las filas amarillas).
    const active = columns.orderActive != null ? yes(get('orderActive')) : !!until || !!orderPrice;
    if (columns.orderActive != null || until || orderPrice) {
      row.orderActive = active;
      if (active && orderPrice && orderPrice > 0) row.orderPrice = orderPrice;
      if (active && until) row.orderUntil = until;
    }
    const notes = text(get('notes'));
    if (notes) row.notes = notes.slice(0, 2000);
    rows.push(row);
  }
  return { columns, headerRow, rows, skipped };
}

/** CSV con «;» (Excel en español), «,» o tabuladores, con comillas. */
export function parseCsv(input: string): string[][] {
  const textIn = input.replace(/^﻿/, '');
  const firstLine = textIn.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', '\t', ','].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ';');
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const c = textIn[i]!;
    if (quoted) {
      if (c === '"' && textIn[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && textIn[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** Bolsa escrita junto al ticker («4COP XETRA») → sufijo de Yahoo. */
const EXCHANGE_WORDS: Record<string, string> = {
  XETRA: '.DE', FRANKFURT: '.F', MADRID: '.MC', BME: '.MC', MCE: '.MC', PARIS: '.PA', EPA: '.PA',
  LONDON: '.L', LONDRES: '.L', LSE: '.L', AMSTERDAM: '.AS', AMS: '.AS', MILAN: '.MI', MILANO: '.MI',
  NYSE: '', NASDAQ: '',
};
/** Sufijos de Yahoo de una letra: no se confunden con la clase de acción («GRF.P»). */
const ONE_LETTER_MARKETS = new Set(['L', 'F', 'V', 'T', 'K', 'S']);

/**
 * Símbolos de Yahoo a probar para un ticker del fichero, en orden de preferencia:
 * «4COP XETRA» → 4COP.DE · «GRF.P» → GRF-P.MC, GRF-P · «ALM» con Madrid → ALM.MC, ALM.
 */
export function symbolCandidates(raw: string, defaultSuffix: string): string[] {
  const sym = raw.trim().toUpperCase();
  const words = sym.split(/[\s.]+/);
  const exch = words.length === 2 ? EXCHANGE_WORDS[words[1]!] : undefined;
  if (exch !== undefined) return [words[0]! + exch];
  const compact = sym.replace(/\s+/g, '');
  if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(compact) || /^0P[A-Z0-9]{8}$/.test(compact)) return [compact];
  const cls = compact.match(/^([A-Z0-9]+)\.([A-Z])$/);
  if (cls && !ONE_LETTER_MARKETS.has(cls[2]!)) {
    const base = `${cls[1]}-${cls[2]}`;
    return [...new Set([defaultSuffix ? base + defaultSuffix : base, base, compact])];
  }
  if (!compact.includes('.') && defaultSuffix) return [compact + defaultSuffix, compact];
  return [compact];
}
