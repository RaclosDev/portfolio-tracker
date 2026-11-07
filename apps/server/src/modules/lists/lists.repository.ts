import type { WatchList } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';

export class ListsRepository {
  constructor(private db: Db) {}

  all(): Promise<WatchList[]> {
    return this.db.query<WatchList>(
      `SELECT l.id, l.name, COUNT(i.id)::int AS "itemCount"
       FROM lists l LEFT JOIN items i ON i.list_id = l.id
       GROUP BY l.id ORDER BY l.position, l.id`,
    );
  }

  async byId(id: number): Promise<WatchList | undefined> {
    return (await this.all()).find((l) => l.id === id);
  }

  async create(name: string): Promise<WatchList> {
    const row = await this.db.one<{ id: number }>(
      'INSERT INTO lists (name, position) VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM lists)) RETURNING id',
      [name],
    );
    return (await this.byId(row!.id))!;
  }

  async rename(id: number, name: string): Promise<WatchList | undefined> {
    await this.db.query('UPDATE lists SET name = $1 WHERE id = $2', [name, id]);
    return this.byId(id);
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.query('DELETE FROM lists WHERE id = $1 RETURNING id', [id])).length > 0;
  }

  async count(): Promise<number> {
    return (await this.db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM lists'))!.n;
  }
}
