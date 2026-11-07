import type { Position, PositionData } from '@watchlist/shared';
import { iso, type Db } from '../../db/database.ts';

interface PositionRow {
  id: number;
  symbol: string;
  name: string | null;
  shares: number;
  avg_price: number;
  cost_base: number | null;
  buy_date: string | null;
  sell_target: number | null;
  notes: string | null;
  muted_until: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const toPosition = (r: PositionRow): Position => ({
  id: r.id,
  symbol: r.symbol,
  name: r.name,
  shares: r.shares,
  avgPrice: r.avg_price,
  costBase: r.cost_base,
  buyDate: r.buy_date,
  sellTarget: r.sell_target,
  notes: r.notes,
  mutedUntil: (r.muted_until as Position['mutedUntil']) ?? null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const COLUMNS = ['symbol', 'name', 'shares', 'avg_price', 'cost_base', 'buy_date', 'sell_target', 'notes', 'muted_until'] as const;
const values = (d: PositionData) => [d.symbol, d.name, d.shares, d.avgPrice, d.costBase, d.buyDate, d.sellTarget, d.notes, d.mutedUntil];

export class PositionsRepository {
  constructor(private db: Db) {}

  async all(): Promise<Position[]> {
    return (await this.db.query<PositionRow>('SELECT * FROM positions ORDER BY position, id')).map(toPosition);
  }

  async byId(id: number): Promise<Position | undefined> {
    const row = await this.db.one<PositionRow>('SELECT * FROM positions WHERE id = $1', [id]);
    return row && toPosition(row);
  }

  async bySymbol(symbol: string): Promise<Position | undefined> {
    const row = await this.db.one<PositionRow>('SELECT * FROM positions WHERE symbol = $1', [symbol]);
    return row && toPosition(row);
  }

  async create(data: PositionData): Promise<Position> {
    const row = await this.db.one<PositionRow>(
      `INSERT INTO positions (${COLUMNS.join(', ')}, position)
       VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}, (SELECT COALESCE(MAX(position), 0) + 1 FROM positions))
       RETURNING *`,
      values(data),
    );
    return toPosition(row!);
  }

  async update(id: number, data: PositionData): Promise<Position | undefined> {
    const row = await this.db.one<PositionRow>(
      `UPDATE positions SET ${COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
       WHERE id = $${COLUMNS.length + 1} RETURNING *`,
      [...values(data), id],
    );
    return row && toPosition(row);
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.query('DELETE FROM positions WHERE id = $1 RETURNING id', [id])).length > 0;
  }

  async deleteAll() {
    await this.db.query('DELETE FROM positions');
  }
}
