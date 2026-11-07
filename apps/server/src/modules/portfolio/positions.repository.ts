import type { Position, PositionData } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';

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
  created_at: string;
  updated_at: string;
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
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toParams = (d: PositionData) => ({
  symbol: d.symbol,
  name: d.name,
  shares: d.shares,
  avg_price: d.avgPrice,
  cost_base: d.costBase,
  buy_date: d.buyDate,
  sell_target: d.sellTarget,
  notes: d.notes,
  muted_until: d.mutedUntil,
});

const COLUMNS = Object.keys(toParams({} as PositionData));

export class PositionsRepository {
  constructor(private db: Db) {}

  all(): Position[] {
    return (this.db.prepare('SELECT * FROM positions ORDER BY position, id').all() as unknown as PositionRow[]).map(toPosition);
  }

  byId(id: number): Position | undefined {
    const row = this.db.prepare('SELECT * FROM positions WHERE id = ?').get(id) as unknown as PositionRow | undefined;
    return row && toPosition(row);
  }

  bySymbol(symbol: string): Position | undefined {
    const row = this.db.prepare('SELECT * FROM positions WHERE symbol = ?').get(symbol) as unknown as PositionRow | undefined;
    return row && toPosition(row);
  }

  create(data: PositionData): Position {
    const sql = `INSERT INTO positions (${COLUMNS.join(', ')}, position)
      VALUES (${COLUMNS.map((c) => ':' + c).join(', ')}, (SELECT COALESCE(MAX(position), 0) + 1 FROM positions))`;
    const { lastInsertRowid } = this.db.prepare(sql).run(toParams(data));
    return this.byId(Number(lastInsertRowid))!;
  }

  update(id: number, data: PositionData): Position | undefined {
    const sql = `UPDATE positions SET ${COLUMNS.map((c) => `${c} = :${c}`).join(', ')},
      updated_at = datetime('now') WHERE id = :id`;
    this.db.prepare(sql).run({ ...toParams(data), id });
    return this.byId(id);
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM positions WHERE id = ?').run(id).changes > 0;
  }

  deleteAll() {
    this.db.prepare('DELETE FROM positions').run();
  }
}
