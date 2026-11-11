import { backupSchema, itemInputSchema, type Backup } from '@watchlist/shared';
import { iso, type Db } from '../../db/database.ts';
import { ItemsRepository } from '../items/items.repository.ts';
import { ListsRepository } from '../lists/lists.repository.ts';
import { InstrumentsRepository, OperationsRepository } from '../portfolio/cartera.repository.ts';
import { SettingsRepository } from '../settings/settings.repository.ts';
import { PortfolioService } from '../portfolio/portfolio.service.ts';

/** Copias guardadas en la base de datos que se conservan (las más recientes). */
const KEEP_SNAPSHOTS = 40;

export interface SnapshotInfo {
  id: number;
  createdAt: string;
  reason: string;
  items: number;
  /** Operaciones de la cartera. */
  operations: number;
}

export class BackupService {
  constructor(private db: Db) {}

  async export(db: Db = this.db): Promise<Backup> {
    const lists = new ListsRepository(db);
    const items = new ItemsRepository(db);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: await new SettingsRepository(db).get(),
      lists: await Promise.all(
        (await lists.all()).map(async (l) => ({
          name: l.name,
          items: (await items.byList(l.id)).map(({ id, listId, createdAt, updatedAt, ...rest }) => rest),
        })),
      ),
      portfolio: {
        instruments: await new InstrumentsRepository(db).all(),
        operations: (await new OperationsRepository(db).all()).map(({ id, createdAt, updatedAt, ...rest }) => rest),
      },
    };
  }

  /**
   * Reemplaza todas las listas y valores por el contenido de la copia (y la cartera, si la copia la trae:
   * las copias antiguas no la tienen y no deben borrarla; sus «positions» del formato viejo se ignoran). Antes guarda lo que había como copia.
   */
  async import(raw: unknown): Promise<{ lists: number; items: number; operations: number; savedTo: string | null }> {
    const data = backupSchema.parse(raw);
    let count = 0;
    const saved = await this.db.tx(async (t) => {
      const saved = await this.snapshot('antes de importar', t, { skipIfEmpty: true });
      const lists = new ListsRepository(t);
      const items = new ItemsRepository(t);
      await t.exec('DELETE FROM items; DELETE FROM lists;');
      if (data.settings) await new SettingsRepository(t).update(data.settings);
      for (const l of data.lists) {
        const list = await lists.create(l.name);
        for (const it of l.items) {
          await items.create(itemInputSchema.parse({ ...it, listId: list.id }));
          count++;
        }
      }
      if (!data.lists.length) await lists.create('Vigilar nuevas');
      if (data.portfolio) {
        const operations = new OperationsRepository(t);
        const instruments = new InstrumentsRepository(t);
        await operations.deleteAll();
        await instruments.deleteAll();
        for (const i of data.portfolio.instruments) await instruments.upsert(i);
        for (const o of data.portfolio.operations) await operations.create(o);
        PortfolioService.assertValid(await operations.all());
      }
      return saved;
    });
    return {
      lists: data.lists.length,
      items: count,
      operations: data.portfolio?.operations.length ?? 0,
      savedTo: saved ? `la copia del ${new Date(saved.createdAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}` : null,
    };
  }

  /** Guarda una copia completa en la base de datos y borra las más antiguas. */
  async snapshot(reason: string, db: Db = this.db, { skipIfEmpty = false } = {}): Promise<SnapshotInfo | null> {
    const data = await this.export(db);
    const items = data.lists.reduce((n, l) => n + l.items.length, 0);
    const operations = data.portfolio?.operations.length ?? 0;
    if (skipIfEmpty && !items && !operations) return null;
    const row = await db.one<{ id: number; created_at: Date | string }>(
      'INSERT INTO snapshots (reason, data) VALUES ($1, $2::jsonb) RETURNING id, created_at',
      [reason, JSON.stringify(data)],
    );
    await db.query(
      'DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY created_at DESC, id DESC LIMIT $1)',
      [KEEP_SNAPSHOTS],
    );
    return { id: row!.id, createdAt: iso(row!.created_at), reason, items, operations };
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const rows = await this.db.query<{ id: number; created_at: Date | string; reason: string; items: number; operations: number }>(
      `SELECT id, created_at, reason,
              (SELECT COALESCE(SUM(jsonb_array_length(l->'items')), 0)::int FROM jsonb_array_elements(data->'lists') l) AS items,
              COALESCE(jsonb_array_length(data->'portfolio'->'operations'), 0)::int AS operations
       FROM snapshots ORDER BY created_at DESC, id DESC`,
    );
    return rows.map((r) => ({ id: r.id, createdAt: iso(r.created_at), reason: r.reason, items: r.items, operations: r.operations }));
  }

  async getSnapshot(id: number): Promise<Backup | undefined> {
    return (await this.db.one<{ data: Backup }>('SELECT data FROM snapshots WHERE id = $1', [id]))?.data;
  }
}
