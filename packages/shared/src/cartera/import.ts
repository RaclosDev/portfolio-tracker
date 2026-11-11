import { z } from 'zod';
import type { Cell } from './excel.ts';
import { instrumentInputSchema, operationInputSchema, OPERATION_TYPES, type Instrument, type OperationData, type OperationType } from './schemas.ts';

export const IMPORT_FIELDS = {
  date: 'Fecha', ticker: 'Ticker / símbolo', isin: 'ISIN', name: 'Nombre del valor', type: 'Tipo de operación',
  shares: 'Cantidad / participaciones', price: 'Precio por unidad', amount: 'Importe', fees: 'Comisiones',
  currency: 'Divisa del valor', fxRate: 'Cambio: divisa por 1 €', broker: 'Bróker',
  withholdingEs: 'Retención España (€)', withholdingForeign: 'Retención origen (€)', splitRatio: 'Ratio del split', notes: 'Notas',
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
export type ColumnMap = Partial<Record<ImportField, number>>;
export const normalizeImportText = (v: Cell) => String(v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s.-]+/g, ' ');
const text = (v: Cell) => String(v ?? '').trim();
const aliases: Record<ImportField, string[]> = {
  date: ['fecha', 'date', 'trade date', 'transaction date', 'fecha operacion', 'fecha de operacion'],
  ticker: ['ticker', 'symbol', 'simbolo', 'codigo valor', 'simbolo yahoo'], isin: ['isin', 'codigo isin'],
  name: ['nombre', 'name', 'instrument', 'instrumento', 'producto', 'product', 'security', 'valor'],
  type: ['tipo', 'type', 'operation', 'operacion', 'transaction type', 'tipo de operacion', 'side', 'buy/sell', 'accion'],
  shares: ['cantidad', 'quantity', 'qty', 'shares', 'units', 'unidades', 'titulos', 'participaciones', 'numero de titulos', 'acciones'],
  price: ['precio', 'price', 'precio unitario', 'unit price', 'execution price'],
  amount: ['importe', 'amount', 'total', 'importe total', 'total eur', 'importe eur', 'importe total eur', 'net amount', 'neto', 'bruto', 'gross amount'],
  fees: ['comisiones', 'comision', 'fees', 'fee', 'commission', 'gastos'],
  currency: ['divisa', 'currency', 'moneda'], fxRate: ['cambio', 'fx', 'fx rate', 'exchange rate', 'tipo de cambio', 't/c'],
  broker: ['broker', 'intermediario', 'entidad'], withholdingEs: ['retencion espana', 'retencion espana eur', 'retencion es'],
  withholdingForeign: ['retencion origen', 'retencion origen eur', 'foreign tax'], splitRatio: ['ratio', 'split ratio', 'relacion'], notes: ['notas', 'notes', 'observaciones'],
};
const headerText = (v: Cell) => normalizeImportText(v).replace(/[()€]/g, '').trim();

export function detectImportColumns(header: Cell[]): ColumnMap {
  const result: ColumnMap = {};
  for (const field of Object.keys(IMPORT_FIELDS) as ImportField[]) {
    const matches = header.flatMap((v, i) => aliases[field].includes(headerText(v)) ? [i] : []);
    // Dos fechas o dos importes no se resuelven por el orden de las columnas.
    if (matches.length === 1) result[field] = matches[0]!;
  }
  return result;
}

export function detectImportHeader(rows: Cell[][]): number {
  let best = 0, score = 0;
  rows.slice(0, 50).forEach((row, i) => {
    const count = Object.keys(detectImportColumns(row)).length;
    if (count > score) { best = i; score = count; }
  });
  return best;
}

const fieldNames = Object.keys(IMPORT_FIELDS) as [ImportField, ...ImportField[]];
export const importOptionsSchema = z.object({
  columns: z.partialRecord(z.enum(fieldNames), z.number().int().nonnegative()),
  dateFormat: z.enum(['auto', 'dmy', 'mdy']).default('auto'),
  numberFormat: z.enum(['auto', 'comma', 'dot']).default('auto'),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).default('EUR'),
  defaultBroker: z.string().max(40).default(''),
  defaultType: z.enum(OPERATION_TYPES).optional(),
  typeMap: z.record(z.string(), z.enum([...OPERATION_TYPES, 'skip'])).default({}),
  amountCurrency: z.enum(['EUR', 'instrument']).optional(),
  amountIncludesFees: z.boolean().default(true),
  incomeIsNet: z.boolean().default(false),
});
export type ImportOptions = z.output<typeof importOptionsSchema>;

const typeAliases: Record<string, OperationType> = {
  compra: 'buy', buy: 'buy', purchase: 'buy', suscripcion: 'buy', subscription: 'buy',
  venta: 'sell', sell: 'sell', sale: 'sell', reembolso: 'sell', redemption: 'sell',
  dividendo: 'dividend', dividend: 'dividend', dividends: 'dividend', dividendos: 'dividend',
  scrip: 'scrip', 'scrip dividend': 'scrip', 'venta de derechos': 'rights_sale', 'venta derechos': 'rights_sale',
  'prima de emision': 'issue_premium', 'prima de asistencia': 'attendance_premium', split: 'split',
  'rights sale': 'rights_sale', 'issue premium': 'issue_premium', 'attendance premium': 'attendance_premium',
};
export function importOperationType(value: Cell, options: ImportOptions): OperationType | 'skip' | undefined {
  const key = normalizeImportText(value);
  return options.typeMap[key] ?? typeAliases[key] ?? (options.columns.type == null ? options.defaultType : undefined);
}

export function importNumber(value: Cell, format: ImportOptions['numberFormat']): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new Error('Número no válido.');
  }
  let s = text(value).replace(/[€$£\s\u00a0]/g, '');
  if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  let decimal = format;
  if (decimal === 'auto') {
    if (s.includes(',') && s.includes('.')) decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? 'comma' : 'dot';
    else if (/^-?\d{1,3}[.,]\d{3}$/.test(s)) throw new Error(`«${text(value)}» es ambiguo: elige el separador decimal.`);
    else decimal = s.includes(',') ? 'comma' : 'dot';
  }
  const pattern = decimal === 'comma' ? /^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/ : /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!pattern.test(s)) throw new Error(`Número «${text(value)}» no válido para el formato elegido.`);
  s = decimal === 'comma' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Número fuera de rango.');
  return n;
}

export function importDate(value: Cell, format: ImportOptions['dateFormat']): string {
  let y: number, m: number, d: number;
  if (typeof value === 'number' && value > 0 && value < 100000) value = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    y = value.getUTCFullYear(); m = value.getUTCMonth() + 1; d = value.getUTCDate();
  } else {
    const s = text(value);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
    const local = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?: \d{2}:\d{2}(?::\d{2})?)?$/);
    if (iso) { y = +iso[1]!; m = +iso[2]!; d = +iso[3]!; }
    else if (local) {
      const a = +local[1]!, b = +local[2]!;
      if (format === 'auto' && a <= 12 && b <= 12 && a !== b) throw new Error(`Fecha «${s}» ambigua: elige día/mes o mes/día.`);
      const monthFirst = format === 'mdy' || (format === 'auto' && b > 12);
      y = +local[3]!; m = monthFirst ? a : b; d = monthFirst ? b : a;
    } else throw new Error('Fecha no reconocida. Usa AAAA-MM-DD o indica el orden de día y mes.');
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error('La fecha no existe.');
  return date.toISOString().slice(0, 10);
}

export interface ImportInstrument extends Instrument { key: string; problem?: string }
const getCell = (row: Cell[], columns: ColumnMap, field: ImportField) => columns[field] == null ? null : row[columns[field]!];
export const importInstrumentKey = (row: Cell[], columns: ColumnMap) => text(getCell(row, columns, 'ticker') || getCell(row, columns, 'isin') || getCell(row, columns, 'name')).toUpperCase();

export function discoverImportInstruments(rows: Cell[][], options: ImportOptions, existing: Instrument[]): ImportInstrument[] {
  const found = new Map<string, ImportInstrument>();
  for (const row of rows) {
    if (importOperationType(getCell(row, options.columns, 'type'), options) === 'skip') continue;
    const key = importInstrumentKey(row, options.columns);
    if (!key) continue;
    const isin = text(getCell(row, options.columns, 'isin')).toUpperCase();
    const ticker = text(getCell(row, options.columns, 'ticker')).toUpperCase();
    const known = existing.find((i) => i.ticker === key || (isin && i.isin?.toUpperCase() === isin));
    const currency = text(getCell(row, options.columns, 'currency')).toUpperCase() || known?.currency || options.defaultCurrency;
    const previous = found.get(key);
    if (previous) {
      if (previous.currency !== currency) previous.problem = 'Este valor tiene varias divisas en el archivo. Revisa qué columna identifica la divisa del valor.';
      if (isin && previous.isin && previous.isin !== isin) previous.problem = 'El mismo identificador tiene varios ISIN en el archivo. Revisa la columna que identifica cada valor.';
      if (!previous.isin && isin) previous.isin = isin;
      continue;
    }
    const identityConflict = known && ticker && isin && known.isin && known.isin.toUpperCase() !== isin;
    found.set(key, {
      key, ticker: known?.ticker ?? (ticker || isin),
      symbol: known ? known.symbol : (/^0P[A-Z0-9]{8}(?:\.[A-Z]{1,3})?$/.test(ticker) ? ticker : null),
      name: known?.name ?? (text(getCell(row, options.columns, 'name')) || null),
      sector: known?.sector ?? null, isin: known?.isin ?? (isin || null), notes: known?.notes ?? null, currency,
      ...(identityConflict ? { problem: 'El ticker y el ISIN no corresponden al mismo valor de tu cartera.' } : {}),
    });
  }
  return [...found.values()];
}

export function importMappingProblems(options: ImportOptions): string[] {
  const errors: string[] = [];
  const c = options.columns;
  if (!/^[A-Z]{3}$/.test(options.defaultCurrency)) errors.push('Indica una divisa de tres letras, como EUR o USD.');
  if (c.date == null) errors.push('Indica la columna de fecha.');
  if (c.ticker == null && c.isin == null && c.name == null) errors.push('Indica una columna de ticker, ISIN o nombre del valor.');
  if (c.type == null && !options.defaultType) errors.push('Indica la columna de tipo de operación o un tipo para todo el archivo.');
  if (c.amount != null && !options.amountCurrency) errors.push('Indica si los importes están en euros o en la divisa del valor.');
  const selected = Object.values(c);
  if (new Set(selected).size !== selected.length) errors.push('Una columna está asignada a varios campos. Revisa la correspondencia.');
  return errors;
}

export interface ImportPreviewRow { line: number; label: string; operation?: OperationData; errors: string[]; skipped?: boolean }

export function previewImport(rows: Cell[][], headerIndex: number, options: ImportOptions, instruments: ImportInstrument[]): ImportPreviewRow[] {
  const byKey = new Map(instruments.map((i) => [i.key, i]));
  return rows.slice(headerIndex + 1).flatMap((row, index) => {
    if (row.every((v) => v == null || text(v) === '')) return [];
    const get = (f: ImportField) => getCell(row, options.columns, f);
    const result: ImportPreviewRow = { line: headerIndex + index + 2, label: importInstrumentKey(row, options.columns), errors: [] };
    const type = importOperationType(get('type'), options);
    if (type === 'skip') return [{ ...result, skipped: true }];
    if (!type) result.errors.push(`Indica qué significa el tipo «${text(get('type')) || '(vacío)'}».`);
    const instrument = byKey.get(result.label);
    if (!instrument) result.errors.push('Falta identificar el valor.');
    else {
      const valid = instrumentInputSchema.safeParse(instrument);
      if (!valid.success) result.errors.push('Revisa el identificador (máximo 32 caracteres), el ISIN y la divisa del valor.');
      if (!/^[A-Z]{3}$/.test(instrument.currency)) result.errors.push('La divisa debe tener tres letras, como EUR o USD.');
      if (instrument.problem) result.errors.push(instrument.problem);
    }
    let date = '';
    try { date = importDate(get('date'), options.dateFormat); } catch (e) { result.errors.push((e as Error).message); }
    const number = (field: ImportField) => {
      try { return importNumber(get(field), options.numberFormat); }
      catch (e) { result.errors.push(`${IMPORT_FIELDS[field]}: ${(e as Error).message}`); return null; }
    };
    const shares = number('shares'), price = number('price'), fees = Math.abs(number('fees') ?? 0);
    const amount = number('amount'), fx = number('fxRate');
    const withholdingEs = number('withholdingEs'), withholdingForeign = number('withholdingForeign'), splitRatio = number('splitRatio');
    const fxRate = fx ?? (instrument?.currency === 'EUR' ? 1 : null);
    if (!fxRate || fxRate <= 0) result.errors.push('Falta un cambio histórico válido: unidades de la divisa del valor por 1 € (no el cambio actual).');
    if (instrument?.currency === 'EUR' && fxRate !== 1) result.errors.push('Para un valor en EUR, el tipo de cambio debe ser 1.');
    if (type === 'buy' || type === 'sell') {
      if (!shares) result.errors.push('Falta la cantidad de títulos o participaciones.');
      if (amount == null && price == null) result.errors.push('Falta el importe o el precio de la operación.');
    } else if (type && type !== 'scrip' && type !== 'split' && amount == null) result.errors.push('Falta el importe del cobro.');
    let amountEur = amount == null ? 0 : Math.abs(amount) / (options.amountCurrency === 'EUR' ? 1 : (fxRate ?? 1));
    if (type === 'buy' || type === 'sell') {
      const signedFee = type === 'buy' ? fees : -fees;
      if (amount == null) amountEur = (Math.abs(shares ?? 0) * (price ?? 0) + signedFee) / (fxRate ?? 1);
      else if (!options.amountIncludesFees) amountEur += signedFee / (fxRate ?? 1);
    } else if (type === 'scrip' || type === 'split') amountEur = 0;
    else if (options.incomeIsNet) amountEur += Math.abs(withholdingEs ?? 0) + Math.abs(withholdingForeign ?? 0) + fees / (fxRate ?? 1);
    if (type && instrument && result.errors.length === 0) {
      const parsed = operationInputSchema.safeParse({
        date, ticker: instrument.ticker, type, shares: shares == null ? null : Math.abs(shares), price, fees, fxRate, amountEur,
        withholdingEs: withholdingEs == null ? null : Math.abs(withholdingEs), withholdingForeign: withholdingForeign == null ? null : Math.abs(withholdingForeign),
        splitRatio, broker: text(get('broker')) || options.defaultBroker || null, notes: text(get('notes')) || null, source: 'excel',
      });
      if (parsed.success) result.operation = parsed.data;
      else result.errors.push(...parsed.error.issues.map((e) => e.message));
    }
    return [result];
  });
}

/** Ignora metadatos de importación: el mismo movimiento puede llegar en archivos distintos. */
export function operationFingerprint(o: OperationData): string {
  const n = (value: number | null) => value == null ? null : Number(value.toPrecision(12));
  return JSON.stringify([o.date, o.ticker.toUpperCase(), o.type, n(o.shares), n(o.price), n(o.amountEur), n(o.fees), n(o.fxRate),
    n(o.withholdingEs ?? 0), n(o.withholdingForeign ?? 0), n(o.splitRatio), normalizeImportText(o.broker)]);
}
