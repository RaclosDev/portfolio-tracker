/**
 * Utilidades para la carpeta de datos, que puede estar sincronizada entre varios PCs
 * (OneDrive, Google Drive, Dropbox…): aviso de uso simultáneo, copias diarias y
 * detección de copias en conflicto creadas por la sincronización.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DB_FILE = 'watchlist.db';
const LOCK_FILE = 'en-uso.json';
const BACKUP_DIR = 'copias';
const KEEP_BACKUPS = 30;
/** Si el otro PC no da señales en este tiempo, se considera cerrado (cuelgue, apagado…). */
const LOCK_STALE_MS = 3 * 60_000;
const HEARTBEAT_MS = 60_000;

export interface LockInfo {
  host: string;
  user: string;
  since: string;
  heartbeat: string;
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Copia consistente de una base SQLite (incluye lo pendiente en el WAL). */
function snapshot(fromDb: string, toFile: string) {
  const db = new DatabaseSync(fromDb, { readOnly: true });
  try {
    db.exec(`VACUUM INTO ${sqlString(toFile)}`);
  } finally {
    db.close();
  }
}

/** Si la carpeta nueva está vacía y hay datos de la versión anterior (%APPDATA%), se traen. */
export function migrateLegacyData(dataDir: string, legacyDir: string): boolean {
  const target = path.join(dataDir, DB_FILE);
  const legacy = path.join(legacyDir, DB_FILE);
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return false;
  fs.mkdirSync(dataDir, { recursive: true });
  snapshot(legacy, target);
  return true;
}

/** Una copia por día en datos/copias, conservando las últimas 30. */
export function dailyBackup(dataDir: string, today: string) {
  const db = path.join(dataDir, DB_FILE);
  if (!fs.existsSync(db)) return;
  const dir = path.join(dataDir, BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `watchlist-${today}.db`);
  if (!fs.existsSync(target)) snapshot(db, target);
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^watchlist-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(KEEP_BACKUPS);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
}

/** Ficheros .db que no son el principal: copias en conflicto de OneDrive/Drive/Dropbox. */
export function findConflictCopies(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir)
    .filter((f) => f.toLowerCase().endsWith('.db') && f !== DB_FILE);
}

/** ¿Está la app abierta ahora mismo en otro PC? */
export function otherPcLock(dataDir: string): LockInfo | null {
  try {
    const raw = fs.readFileSync(path.join(dataDir, LOCK_FILE), 'utf8').trimStart(); // trimStart también quita el BOM
    const lock = JSON.parse(raw) as LockInfo;
    const fresh = Date.now() - Date.parse(lock.heartbeat) < LOCK_STALE_MS;
    return lock.host !== os.hostname() && fresh ? lock : null;
  } catch {
    return null;
  }
}

/** Marca la carpeta como "en uso por este PC" y la refresca cada minuto. Devuelve cómo liberarla. */
export function acquireLock(dataDir: string): () => void {
  const file = path.join(dataDir, LOCK_FILE);
  const since = new Date().toISOString();
  const write = () => {
    const info: LockInfo = {
      host: os.hostname(),
      user: os.userInfo().username,
      since,
      heartbeat: new Date().toISOString(),
    };
    try {
      fs.writeFileSync(file, JSON.stringify(info, null, 2));
    } catch {
      /* carpeta momentáneamente no disponible: se reintenta en el siguiente latido */
    }
  };
  write();
  const timer = setInterval(write, HEARTBEAT_MS);
  return () => {
    clearInterval(timer);
    try {
      const lock = JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo;
      if (lock.host === os.hostname()) fs.rmSync(file, { force: true });
    } catch {
      /* ya no existe */
    }
  };
}
