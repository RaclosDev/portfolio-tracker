/**
 * Lectura de la hoja «Registro» del Excel de cartera (una fila por movimiento).
 *
 * Columnas (por nombre de cabecera, no por posición): nº · Fecha · Acción · Ticker · Tipo · Cantidad ·
 * Precio · Div, G e I · T/C · Importe total · Relac.split · F split · Lote.
 *
 * Convenciones del Excel que se traducen aquí:
 *  - Signos de caja: compras en positivo; ventas, dividendos y primas en negativo.
 *  - «Div, G e I» mezcla las comisiones (compras y ventas) con el importe bruto de los cobros.
 *  - «T/C»: unidades de la divisa del valor por 1 €. «Importe total» ya está en euros.
 */
import type { InstrumentInput, OperationInput, OperationType } from './schemas.ts';

export type Cell = string | number | boolean | Date | null | undefined;

const TYPE_MAP: Record<string, OperationType> = {
  compra: 'buy',
  venta: 'sell',
  dividendo: 'dividend',
  scrip: 'scrip',
  'scrip dividend': 'scrip',
  'vta dchos': 'rights_sale',
  'venta de derechos': 'rights_sale',
  'venta derechos': 'rights_sale',
  'prima de emision': 'issue_premium',
  'prima emision': 'issue_premium',
  'prima de asistencia': 'attendance_premium',
  'prima asistencia': 'attendance_premium',
  split: 'split',
};

const norm = (v: Cell) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

const COLUMNS = {
  ref: (h: string) => h === 'n' || h === 'no' || h.startsWith('n') && h.length <= 3,
  date: (h: string) => h === 'fecha',
  ticker: (h: string) => h === 'ticker',
  type: (h: string) => h === 'tipo',
  shares: (h: string) => h === 'cantidad',
  price: (h: string) => h === 'precio',
  extra: (h: string) => h.startsWith('div'),
  fx: (h: string) => h === 't/c' || h === 'tc' || h.startsWith('tipo de cambio'),
  amount: (h: string) => h.startsWith('importe'),
  splitRatio: (h: string) => h.startsWith('relac'),
  lot: (h: string) => h === 'lote',
} as const;
type Col = keyof typeof COLUMNS;

/** Nº de la compra en una referencia de lote del Excel («C-2016/06/24-00033-TEF» → 33). */
export function lotRefOf(v: Cell): number | null {
  const m = typeof v === 'string' ? v.trim().match(/^C-[\d/]+-0*(\d+)-/i) : null;
  return m ? Number(m[1]) : null;
}

/** Número desde una celda (admite «1.234,56» y «1234.56»). */
export function cellNumber(v: Cell): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v instanceof Date) return null;
  let s = v.replace(/[€$\s]/g, '');
  if (/^-?[\d.]+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Fecha AAAA-MM-DD desde una celda (Date, número de serie de Excel o texto dd/mm/aaaa). */
export function cellDate(v: Cell): string | null {
  const p = (n: number) => String(n).padStart(2, '0');
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Las fechas de Excel no tienen hora: el redondeo evita que la zona horaria cambie el día.
    const d = new Date(v.getTime() + 12 * 3_600_000);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  if (typeof v === 'number' && v > 20_000 && v < 80_000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  if (typeof v === 'string') {
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const es = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (es) {
      const y = es[3]!.length === 2 ? 2000 + +es[3]! : +es[3]!;
      return `${y}-${p(+es[2]!)}-${p(+es[1]!)}`;
    }
  }
  return null;
}

export interface RegistroParse {
  operations: OperationInput[];
  /** Un instrumento por ticker, con símbolo de Yahoo y divisa propuestos. */
  instruments: InstrumentInput[];
  warnings: string[];
  /** Filas sin fecha o sin tipo (vacías, totales…). */
  skipped: number;
}

/** Símbolo de Yahoo propuesto para un ticker del Excel. */
export function suggestYahooSymbol(ticker: string, foreign: boolean): string | null {
  ticker = ticker.trim().toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(ticker)) return null;
  if (foreign) return ticker;
  // Yahoo usa «-P» para las acciones sin voto (Grifols clase B: GRF.P → GRF-P.MC).
  if (/\.P$/.test(ticker)) return `${ticker.replace(/\.P$/, '-P')}.MC`;
  if (/[.\^=\-]/.test(ticker) || /^0P[A-Z0-9]{8}$/.test(ticker)) return ticker;
  return `${ticker}.MC`;
}

export interface BrokerRule {
  broker: string | null;
  needsReview: boolean;
}

/**
 * Lee la hoja Registro. `rows` es la hoja entera como filas de celdas.
 * `brokerFor` decide el bróker de cada ticker (por defecto, ninguno).
 */
export function parseRegistro(rows: Cell[][], brokerFor: (ticker: string) => BrokerRule = () => ({ broker: null, needsReview: false })): RegistroParse {
  const headerIdx = rows.findIndex((r) => {
    const h = r.map(norm);
    return h.includes('fecha') && h.includes('ticker') && h.includes('tipo');
  });
  if (headerIdx < 0) throw new Error('No se encuentra la cabecera de la hoja Registro (Fecha, Ticker, Tipo…).');
  const header = rows[headerIdx]!.map(norm);
  const idx = {} as Record<Col, number>;
  for (const key of Object.keys(COLUMNS) as Col[]) idx[key] = header.findIndex((h) => COLUMNS[key](h));
  for (const key of ['date', 'ticker', 'type', 'amount'] as const)
    if (idx[key] < 0) throw new Error(`Falta la columna «${key === 'amount' ? 'Importe total' : key}» en la hoja Registro.`);

  const get = (r: Cell[], k: Col) => (idx[k] >= 0 ? r[idx[k]] : null);
  const operations: OperationInput[] = [];
  const warnings: string[] = [];
  const fxByTicker = new Map<string, Set<number>>();
  let skipped = 0;

  rows.slice(headerIdx + 1).forEach((r, i) => {
    const line = headerIdx + i + 2;
    const date = cellDate(get(r, 'date'));
    const rawType = norm(get(r, 'type'));
    const ticker = String(get(r, 'ticker') ?? '').trim().toUpperCase();
    if (!date || !rawType || !ticker) {
      skipped++;
      return;
    }
    const type = TYPE_MAP[rawType];
    if (!type) {
      warnings.push(`Fila ${line}: tipo «${get(r, 'type')}» desconocido; no se importa.`);
      return;
    }
    const qty = cellNumber(get(r, 'shares'));
    const price = cellNumber(get(r, 'price'));
    const extra = cellNumber(get(r, 'extra')) ?? 0;
    const fx = cellNumber(get(r, 'fx')) || 1;
    const amount = cellNumber(get(r, 'amount')) ?? 0;
    const ref = cellNumber(get(r, 'ref'));
    const rule = brokerFor(ticker);
    if (!fxByTicker.has(ticker)) fxByTicker.set(ticker, new Set());
    fxByTicker.get(ticker)!.add(Math.abs(fx - 1) < 1e-9 ? 1 : 0);

    const common = {
      date,
      ticker,
      type,
      fxRate: fx,
      broker: rule.broker,
      needsReview: rule.needsReview,
      source: 'excel' as const,
      sourceRef: ref != null ? Math.round(ref) : null,
      notes: null as string | null,
    };
    switch (type) {
      case 'buy':
        operations.push({ ...common, shares: Math.abs(qty ?? 0), price, fees: Math.abs(extra), amountEur: Math.abs(amount) });
        break;
      case 'sell':
        operations.push({ ...common, shares: Math.abs(qty ?? 0), price, fees: Math.abs(extra), amountEur: Math.abs(amount) });
        break;
      case 'scrip':
        if (!qty) warnings.push(`Fila ${line}: scrip sin acciones (no cambia nada); no se importa.`);
        else operations.push({ ...common, shares: Math.abs(qty), amountEur: 0, lotRef: lotRefOf(get(r, 'lot')) });
        break;
      case 'split': {
        const ratio = cellNumber(get(r, 'splitRatio')) ?? qty;
        if (!ratio || ratio <= 0) warnings.push(`Fila ${line}: split sin ratio; no se importa.`);
        else operations.push({ ...common, splitRatio: ratio, amountEur: 0 });
        break;
      }
      default: {
        // Cobros: en el Excel van en negativo. Si salen en positivo es que las comisiones superaron el cobro.
        const gross = -amount;
        if (gross < 0) {
          operations.push({
            ...common,
            amountEur: 0,
            fees: Math.abs(amount) * fx,
            notes: 'Importado del Excel: la comisión fue mayor que el importe cobrado.',
          });
        } else {
          operations.push({ ...common, amountEur: gross });
        }
      }
    }
  });

  const instruments: InstrumentInput[] = [...fxByTicker].map(([ticker, fxs]) => {
    const foreign = !fxs.has(1);
    return { ticker, symbol: suggestYahooSymbol(ticker, foreign), currency: foreign ? 'USD' : 'EUR' };
  });
  return { operations, instruments, warnings, skipped };
}

/** Cifras de la cabecera de la hoja Resumen (para comparar con la web). */
export interface ExcelTotals {
  valueEur: number | null;
  unrealizedEur: number | null;
  realizedEur: number | null;
  incomeEur: number | null;
  totalEur: number | null;
}

/** Busca la fila de títulos «Valoración… / P/G realizadas…» y lee la fila de debajo. */
export function parseResumenTotals(rows: Cell[][]): ExcelTotals | null {
  const hi = rows.findIndex((r) => r.some((c) => norm(c).startsWith('p/g realizadas')));
  if (hi < 0 || !rows[hi + 1]) return null;
  const h = rows[hi]!.map(norm);
  const v = rows[hi + 1]!;
  const at = (pred: (s: string) => boolean) => {
    const i = h.findIndex(pred);
    return i >= 0 ? cellNumber(v[i]) : null;
  };
  return {
    valueEur: at((s) => s.startsWith('valoracion')),
    unrealizedEur: at((s) => s.startsWith('p/g no realizadas')),
    realizedEur: at((s) => s.startsWith('p/g realizadas')),
    incomeEur: at((s) => s.startsWith('dividendos')),
    totalEur: at((s) => s.startsWith('p/g totales')),
  };
}
