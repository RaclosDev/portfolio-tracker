import { instrumentInputSchema, type Instrument, type InstrumentInput, type Operation, type OperationData } from '@watchlist/shared';
import { iso, type Db } from '../../db/database.ts';

interface OperationRow {
  id: number;
  date: string;
  ticker: string;
  type: Operation['type'];
  shares: number | null;
  price: number | null;
  fees: number;
  fx_rate: number;
  amount_eur: number;
  withholding_es: number | null;
  withholding_foreign: number | null;
  split_ratio: number | null;
  broker: string | null;
  notes: string | null;
  needs_review: boolean;
  source: Operation['source'];
  source_ref: number | null;
  lot_ref: number | null;
  day_order: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const toOperation = (r: OperationRow): Operation => ({
  id: r.id,
  date: r.date,
  ticker: r.ticker,
  type: r.type,
  shares: r.shares,
  price: r.price,
  fees: r.fees,
  fxRate: r.fx_rate,
  amountEur: r.amount_eur,
  withholdingEs: r.withholding_es,
  withholdingForeign: r.withholding_foreign,
  splitRatio: r.split_ratio,
  broker: r.broker,
  notes: r.notes,
  needsReview: r.needs_review,
  source: r.source,
  sourceRef: r.source_ref,
  lotRef: r.lot_ref,
  dayOrder: r.day_order ?? null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const OP_COLUMNS = [
  'date',
  'ticker',
  'type',
  'shares',
  'price',
  'fees',
  'fx_rate',
  'amount_eur',
  'withholding_es',
  'withholding_foreign',
  'split_ratio',
  'broker',
  'notes',
  'needs_review',
  'source',
  'source_ref',
  'lot_ref',
  'day_order',
] as const;
const opValues = (d: OperationData) => [
  d.date,
  d.ticker,
  d.type,
  d.shares,
  d.price,
  d.fees,
  d.fxRate,
  d.amountEur,
  d.withholdingEs,
  d.withholdingForeign,
  d.splitRatio,
  d.broker,
  d.notes,
  d.needsReview,
  d.source,
  d.sourceRef,
  d.lotRef,
  d.dayOrder,
];

/** Registro de operaciones de la cartera (una fila por movimiento). */
export class OperationsRepository {
  constructor(private db: Db) {}

  async all(): Promise<Operation[]> {
    return (await this.db.query<OperationRow>('SELECT * FROM operations ORDER BY date, day_order NULLS LAST, id')).map(toOperation);
  }

  async byId(id: number): Promise<Operation | undefined> {
    const row = await this.db.one<OperationRow>('SELECT * FROM operations WHERE id = $1', [id]);
    return row && toOperation(row);
  }

  async create(d: OperationData): Promise<Operation> {
    const row = await this.db.one<OperationRow>(
      `INSERT INTO operations (${OP_COLUMNS.join(', ')}) VALUES (${OP_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      opValues(d),
    );
    return toOperation(row!);
  }

  async update(id: number, d: OperationData): Promise<Operation | undefined> {
    const row = await this.db.one<OperationRow>(
      `UPDATE operations SET ${OP_COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
       WHERE id = $${OP_COLUMNS.length + 1} RETURNING *`,
      [...opValues(d), id],
    );
    return row && toOperation(row);
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.query('DELETE FROM operations WHERE id = $1 RETURNING id', [id])).length > 0;
  }

  async setBroker(ids: number[], broker: string | null, needsReview: boolean): Promise<number> {
    const rows = await this.db.query(
      'UPDATE operations SET broker = $1, needs_review = $2, updated_at = now() WHERE id = ANY($3::int[]) RETURNING id',
      [broker, needsReview, ids],
    );
    return rows.length;
  }

  /** Borra las operaciones de un origen ('excel' al reimportar) o todas. */
  async deleteAll(source?: Operation['source']): Promise<number> {
    const rows = source
      ? await this.db.query('DELETE FROM operations WHERE source = $1 RETURNING id', [source])
      : await this.db.query('DELETE FROM operations RETURNING id');
    return rows.length;
  }
}

interface InstrumentRow {
  ticker: string;
  symbol: string | null;
  name: string | null;
  sector: string | null;
  currency: string;
  isin: string | null;
  notes: string | null;
}
const toInstrument = (r: InstrumentRow): Instrument => ({
  ticker: r.ticker,
  symbol: r.symbol,
  name: r.name,
  sector: r.sector,
  currency: r.currency,
  isin: r.isin,
  notes: r.notes,
});

/** Datos de cada valor de la cartera: símbolo de Yahoo, nombre, sector, divisa… */
export class InstrumentsRepository {
  constructor(private db: Db) {}

  async all(): Promise<Instrument[]> {
    return (await this.db.query<InstrumentRow>('SELECT * FROM instruments ORDER BY ticker')).map(toInstrument);
  }

  async byTicker(ticker: string): Promise<Instrument | undefined> {
    const row = await this.db.one<InstrumentRow>('SELECT * FROM instruments WHERE ticker = $1', [ticker]);
    return row && toInstrument(row);
  }

  async upsert(input: InstrumentInput): Promise<Instrument> {
    const d = instrumentInputSchema.parse(input);
    const row = await this.db.one<InstrumentRow>(
      `INSERT INTO instruments (ticker, symbol, name, sector, currency, isin, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ticker) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, sector = excluded.sector,
         currency = excluded.currency, isin = excluded.isin, notes = excluded.notes, updated_at = now()
       RETURNING *`,
      [d.ticker, d.symbol, d.name, d.sector, d.currency, d.isin, d.notes],
    );
    return toInstrument(row!);
  }

  /** Crea el valor si no existe (no toca uno que ya esté). */
  async ensure(input: InstrumentInput): Promise<void> {
    const d = instrumentInputSchema.parse(input);
    await this.db.query(
      `INSERT INTO instruments (ticker, symbol, name, sector, currency, isin, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (ticker) DO NOTHING`,
      [d.ticker, d.symbol, d.name, d.sector, d.currency, d.isin, d.notes],
    );
  }

  /** Rellena el sector (o el nombre) si aún no lo tiene: nunca pisa lo escrito a mano. */
  async fillProfile(ticker: string, p: { sector: string | null; name: string | null }): Promise<void> {
    await this.db.query(
      `UPDATE instruments SET sector = COALESCE(sector, $1), name = COALESCE(name, $2), updated_at = now() WHERE ticker = $3`,
      [p.sector, p.name, ticker],
    );
  }

  async deleteAll() {
    await this.db.query('DELETE FROM instruments');
  }
}
