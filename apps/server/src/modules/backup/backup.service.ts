import fs from 'node:fs';
import path from 'node:path';
import { backupSchema, itemInputSchema, positionInputSchema, type Backup } from '@watchlist/shared';
import { transaction, type Db } from '../../db/database.ts';
import type { ItemsRepository } from '../items/items.repository.ts';
import type { ListsRepository } from '../lists/lists.repository.ts';
import type { PositionsRepository } from '../portfolio/positions.repository.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';

export class BackupService {
  constructor(
    private db: Db,
    private lists: ListsRepository,
    private items: ItemsRepository,
    private settings: SettingsRepository,
    private positions: PositionsRepository,
    /** Carpeta de datos: ahí se guarda la copia previa a cada importación. */
    private dataDir: string | null = null,
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
      positions: this.positions.all().map(({ id, createdAt, updatedAt, ...rest }) => rest),
    };
  }

  /**
   * Reemplaza todas las listas y valores por el contenido de la copia (y la cartera, si la copia la trae:
   * las copias antiguas no tienen cartera y no deben borrarla).
   * Antes guarda lo que había en <datos>/copias/antes-de-importar-<fecha-hora>.json.
   */
  import(raw: unknown): { lists: number; items: number; positions: number; savedTo: string | null } {
    const data = backupSchema.parse(raw);
    const savedTo = this.saveSafetyCopy();
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
      if (data.positions) {
        this.positions.deleteAll();
        for (const p of data.positions) this.positions.create(positionInputSchema.parse(p));
      }
    });
    return { lists: data.lists.length, items: count, positions: data.positions?.length ?? 0, savedTo };
  }

  private saveSafetyCopy(): string | null {
    if (!this.dataDir) return null;
    const current = this.export();
    if (!current.lists.some((l) => l.items.length) && !current.positions?.length) return null; // nada que perder
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const dir = path.join(this.dataDir, 'copias');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `antes-de-importar-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(current, null, 2));
    return file;
  }
}
