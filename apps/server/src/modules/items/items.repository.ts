import type { Item, ItemData } from '@watchlist/shared';
import { iso, type Db } from '../../db/database.ts';

interface ItemRow {
  id: number;
  list_id: number;
  symbol: string;
  name: string | null;
  buy_prices: number[];
  broker_target: number | null;
  broker_name: string | null;
  invest_amount: number | null;
  shares_override: number | null;
  order_active: boolean;
  order_price: number | null;
  order_until: string | null;
  notes: string | null;
  muted_until: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  listId: r.list_id,
  symbol: r.symbol,
  name: r.name,
  buyPrices: r.buy_prices,
  brokerTarget: r.broker_target,
  brokerName: r.broker_name,
  investAmount: r.invest_amount,
  sharesOverride: r.shares_override,
  orderActive: r.order_active,
  orderPrice: r.order_price,
  orderUntil: r.order_until,
  notes: r.notes,
  mutedUntil: (r.muted_until as Item['mutedUntil']) ?? null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/** Columnas y valores en el mismo orden ($1, $2…). */
const COLUMNS = [
  'list_id', 'symbol', 'name', 'buy_prices', 'broker_target', 'broker_name', 'invest_amount',
  'shares_override', 'order_active', 'order_price', 'order_until', 'notes', 'muted_until',
] as const;
const values = (d: ItemData) => [
  d.listId, d.symbol, d.name, JSON.stringify(d.buyPrices), d.brokerTarget, d.brokerName, d.investAmount,
  d.sharesOverride, d.orderActive, d.orderPrice, d.orderUntil, d.notes, d.mutedUntil,
];
const placeholder = (c: string, i: number) => (c === 'buy_prices' ? `$${i + 1}::jsonb` : `$${i + 1}`);

export class ItemsRepository {
  constructor(private db: Db) {}

  async byList(listId: number): Promise<Item[]> {
    const rows = await this.db.query<ItemRow>('SELECT * FROM items WHERE list_id = $1 ORDER BY position, id', [listId]);
    return rows.map(toItem);
  }

  async byId(id: number): Promise<Item | undefined> {
    const row = await this.db.one<ItemRow>('SELECT * FROM items WHERE id = $1', [id]);
    return row && toItem(row);
  }

  async create(data: ItemData): Promise<Item> {
    const n = COLUMNS.length;
    const row = await this.db.one<ItemRow>(
      `INSERT INTO items (${COLUMNS.join(', ')}, position)
       VALUES (${COLUMNS.map(placeholder).join(', ')},
               (SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE list_id = $${n + 1}))
       RETURNING *`,
      [...values(data), data.listId],
    );
    return toItem(row!);
  }

  async update(id: number, data: ItemData): Promise<Item | undefined> {
    const sets = COLUMNS.map((c, i) => `${c} = ${placeholder(c, i)}`).join(', ');
    const row = await this.db.one<ItemRow>(
      `UPDATE items SET ${sets}, updated_at = now() WHERE id = $${COLUMNS.length + 1} RETURNING *`,
      [...values(data), id],
    );
    return row && toItem(row);
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.query('DELETE FROM items WHERE id = $1 RETURNING id', [id])).length > 0;
  }
}
