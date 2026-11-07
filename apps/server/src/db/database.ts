import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.ts';

export type Db = DatabaseSync;

/**
 * WAL: más rápido, pero usa 3 ficheros (.db, -wal, -shm).
 * DELETE: un único fichero; es el modo seguro cuando la carpeta de datos se sincroniza
 * entre PCs (OneDrive, Google Drive, Dropbox…).
 */
export type JournalMode = 'WAL' | 'DELETE';

export function openDatabase(dataDir: string, { journalMode = 'WAL' as JournalMode } = {}): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'watchlist.db'));
  db.exec(`PRAGMA journal_mode = ${journalMode}; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;`);
  migrate(db);
  return db;
}

/** Aplica las migraciones pendientes usando PRAGMA user_version como versión. */
export function migrate(db: Db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
