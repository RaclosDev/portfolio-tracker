import { backupSchema, itemInputSchema, type Backup } from '@watchlist/shared';
import { transaction, type Db } from '../../db/database.ts';
import type { ItemsRepository } from '../items/items.repository.ts';
import type { ListsRepository } from '../lists/lists.repository.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';

export class BackupService {
  constructor(
    private db: Db,
    private lists: ListsRepository,
    private items: ItemsRepository,
    private settings: SettingsRepository,
  ) {}

  export(): Backup {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings.get(),
      lists: this.lists.all().map((l) => ({
        name: l.name,
        items: this.items.byList(l.id).map(({ id, listId, createdAt, updatedAt, ...rest }) => rest),
      })),
    };
  }

  /** Reemplaza todas las listas y valores por el contenido de la copia. */
  import(raw: unknown): { lists: number; items: number } {
    const data = backupSchema.parse(raw);
    let count = 0;
    transaction(this.db, () => {
      this.db.exec('DELETE FROM items; DELETE FROM lists;');
      if (data.settings) this.settings.update(data.settings);
      for (const l of data.lists) {
        const list = this.lists.create(l.name);
        for (const it of l.items) {
          this.items.create(itemInputSchema.parse({ ...it, listId: list.id }));
          count++;
        }
      }
      if (!data.lists.length) this.lists.create('Vigilar nuevas');
    });
    return { lists: data.lists.length, items: count };
  }
}
