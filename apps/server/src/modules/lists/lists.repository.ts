import type { WatchList } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';

export class ListsRepository {
  constructor(private db: Db) {}

  all(): WatchList[] {
    return this.db
      .prepare(
        `SELECT l.id, l.name, COUNT(i.id) AS itemCount
         FROM lists l LEFT JOIN items i ON i.list_id = l.id
         GROUP BY l.id ORDER BY l.position, l.id`,
      )
      .all() as unknown as WatchList[];
  }

  byId(id: number): WatchList | undefined {
    return this.all().find((l) => l.id === id);
  }

  create(name: string): WatchList {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO lists (name, position) VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM lists))')
      .run(name);
    return this.byId(Number(lastInsertRowid))!;
  }

  rename(id: number, name: string): WatchList | undefined {
    this.db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(name, id);
    return this.byId(id);
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM lists WHERE id = ?').run(id).changes > 0;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM lists').get() as { n: number }).n;
  }
}
