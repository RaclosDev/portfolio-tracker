import type { Item, ItemData } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';

interface ItemRow {
  id: number;
  list_id: number;
  symbol: string;
  name: string | null;
  buy_prices: string;
  broker_target: number | null;
  broker_name: string | null;
  invest_amount: number | null;
  shares_override: number | null;
  order_active: number;
  order_price: number | null;
  order_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  listId: r.list_id,
  symbol: r.symbol,
  name: r.name,
  buyPrices: JSON.parse(r.buy_prices) as number[],
  brokerTarget: r.broker_target,
  brokerName: r.broker_name,
  investAmount: r.invest_amount,
  sharesOverride: r.shares_override,
  orderActive: r.order_active === 1,
  orderPrice: r.order_price,
  orderUntil: r.order_until,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toParams = (d: ItemData) => ({
  list_id: d.listId,
  symbol: d.symbol,
  name: d.name,
  buy_prices: JSON.stringify(d.buyPrices),
  broker_target: d.brokerTarget,
  broker_name: d.brokerName,
  invest_amount: d.investAmount,
  shares_override: d.sharesOverride,
  order_active: d.orderActive ? 1 : 0,
  order_price: d.orderPrice,
  order_until: d.orderUntil,
  notes: d.notes,
});

const COLUMNS = Object.keys(toParams({} as ItemData));

export class ItemsRepository {
  constructor(private db: Db) {}

  byList(listId: number): Item[] {
    const rows = this.db
      .prepare('SELECT * FROM items WHERE list_id = ? ORDER BY position, id')
      .all(listId) as unknown as ItemRow[];
    return rows.map(toItem);
  }

  byId(id: number): Item | undefined {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as unknown as ItemRow | undefined;
    return row && toItem(row);
  }

  create(data: ItemData): Item {
    const sql = `INSERT INTO items (${COLUMNS.join(', ')}, position)
      VALUES (${COLUMNS.map((c) => ':' + c).join(', ')},
              (SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE list_id = :list_id))`;
    const { lastInsertRowid } = this.db.prepare(sql).run(toParams(data));
    return this.byId(Number(lastInsertRowid))!;
  }

  update(id: number, data: ItemData): Item | undefined {
    const sql = `UPDATE items SET ${COLUMNS.map((c) => `${c} = :${c}`).join(', ')},
      updated_at = datetime('now') WHERE id = :id`;
    this.db.prepare(sql).run({ ...toParams(data), id });
    return this.byId(id);
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
  }

  allSymbols(): string[] {
    return (this.db.prepare('SELECT DISTINCT symbol FROM items').all() as { symbol: string }[]).map((r) => r.symbol);
  }
}
