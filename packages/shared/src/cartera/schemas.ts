import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const ticker = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .transform((s) => s.toUpperCase());
const money = z.number().finite();
const nonNeg = z.number().finite().nonnegative();

/**
 * Tipos de operación del registro. Los nombres de pantalla están en OPERATION_LABELS.
 *  - buy / sell: compra y venta de acciones.
 *  - dividend: dividendo (en bruto, con sus retenciones aparte).
 *  - scrip: acciones liberadas (dividendo en acciones): suman acciones sin coste.
 *  - rights_sale: venta de derechos de suscripción.
 *  - issue_premium: devolución de prima de emisión.
 *  - attendance_premium: prima de asistencia a la junta.
 *  - split: desdoblamiento o contrasplit (ratio = acciones nuevas por cada antigua).
 */
export const OPERATION_TYPES = [
  'buy',
  'sell',
  'dividend',
  'scrip',
  'rights_sale',
  'issue_premium',
  'attendance_premium',
  'split',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const OPERATION_LABELS: Record<OperationType, string> = {
  buy: 'Compra',
  sell: 'Venta',
  dividend: 'Dividendo',
  scrip: 'Scrip (acciones liberadas)',
  rights_sale: 'Venta de derechos',
  issue_premium: 'Prima de emisión',
  attendance_premium: 'Prima de asistencia',
  split: 'Split / contrasplit',
};

/** Tipos que son cobros (rendimientos): llevan importe bruto y retenciones. */
export const INCOME_TYPES: readonly OperationType[] = ['dividend', 'rights_sale', 'issue_premium', 'attendance_premium'];
export const isIncome = (t: OperationType) => INCOME_TYPES.includes(t);

/** Brókers sugeridos en el formulario (se puede escribir otro). */
export const KNOWN_BROKERS = ['ING', 'MyInvestor'] as const;

/**
 * Una operación del registro.
 *
 * Importes:
 *  - `amountEur`: compra → coste total en € con comisiones; venta → lo recibido en € ya sin comisiones;
 *    cobros (dividendo, primas, derechos) → importe BRUTO en €; scrip y split → 0.
 *  - `fees`: comisiones y gastos en la divisa del valor (informativo en compras y ventas, que ya las
 *    incluyen en `amountEur`; en los cobros se restan del bruto).
 *  - `fxRate`: unidades de la divisa del valor por 1 € el día de la operación (1 si cotiza en euros).
 *  - Retenciones en €: `withholdingEs` (España) y `withholdingForeign` (país de origen). null = sin dato.
 */
export const operationInputSchema = z
  .object({
    date: isoDate,
    ticker,
    type: z.enum(OPERATION_TYPES),
    shares: nonNeg.nullable().default(null),
    price: nonNeg.nullable().default(null),
    fees: nonNeg.default(0),
    fxRate: z.number().finite().positive().default(1),
    amountEur: money,
    withholdingEs: nonNeg.nullable().default(null),
    withholdingForeign: nonNeg.nullable().default(null),
    splitRatio: z.number().finite().positive().nullable().default(null),
    broker: z.string().trim().max(40).nullable().default(null),
    notes: z.string().max(1000).nullable().default(null),
    /** Marcada para revisar (p. ej. el bróker de una importación). */
    needsReview: z.boolean().default(false),
    source: z.enum(['manual', 'excel']).default('manual'),
    /** Nº de la fila en el Excel de origen. */
    sourceRef: z.number().int().nullable().default(null),
  })
  .superRefine((o, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (!cond) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (o.type === 'buy' || o.type === 'sell') {
      need((o.shares ?? 0) > 0, 'shares', 'Indica cuántas acciones');
      need(o.amountEur >= 0, 'amountEur', 'El importe no puede ser negativo');
    }
    if (o.type === 'buy') need(o.amountEur > 0, 'amountEur', 'Indica el importe total en euros');
    if (o.type === 'scrip') need((o.shares ?? 0) > 0, 'shares', 'Indica cuántas acciones has recibido');
    if (o.type === 'split') need(o.splitRatio != null && o.splitRatio !== 1, 'splitRatio', 'Indica el ratio (p. ej. 2 = cada acción pasa a ser 2)');
    if (o.type === 'dividend' || o.type === 'attendance_premium' || o.type === 'issue_premium')
      need(o.amountEur >= 0, 'amountEur', 'El importe bruto no puede ser negativo');
  });
export type OperationInput = z.input<typeof operationInputSchema>;
export type OperationData = z.output<typeof operationInputSchema>;

export interface Operation extends OperationData {
  id: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Un valor de la cartera: el ticker del registro y cómo se busca en Yahoo. */
export const instrumentInputSchema = z.object({
  ticker,
  /** Símbolo de Yahoo Finance (TEF.MC, IBM…). Si falta, no hay precio actual. */
  symbol: z
    .string()
    .trim()
    .max(32)
    .transform((s) => s.toUpperCase())
    .nullable()
    .default(null),
  name: z.string().trim().max(120).nullable().default(null),
  sector: z.string().trim().max(80).nullable().default(null),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(3)
    .default('EUR'),
  isin: z.string().trim().max(12).nullable().default(null),
  notes: z.string().max(1000).nullable().default(null),
});
export type InstrumentInput = z.input<typeof instrumentInputSchema>;
export type Instrument = z.output<typeof instrumentInputSchema>;

export const instrumentPatchSchema = instrumentInputSchema.omit({ ticker: true }).partial();
export type InstrumentPatch = z.input<typeof instrumentPatchSchema>;

/** Importación del registro completo (sustituye lo importado antes). */
export const carteraImportSchema = z.object({
  instruments: z.array(instrumentInputSchema).max(500),
  operations: z.array(operationInputSchema).min(1).max(20_000),
});
export type CarteraImport = z.input<typeof carteraImportSchema>;

export const bulkBrokerSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(5000),
  broker: z.string().trim().max(40).nullable(),
  needsReview: z.boolean().default(false),
});
