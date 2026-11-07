/**
 * Base de datos PostgreSQL.
 *  - Producción: Neon (DATABASE_URL), con el driver `pg`.
 *  - Desarrollo y tests: PGlite, un Postgres real compilado a WebAssembly que corre dentro de Node
 *    (en una carpeta local o en memoria). No hace falta instalar nada y el SQL es el mismo.
 */
import fs from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import pg from 'pg';
import { migrations } from './migrations.ts';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Primera fila o undefined. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Varias sentencias seguidas, sin parámetros (migraciones). */
  exec(sql: string): Promise<void>;
  /** Todo o nada. Dentro de una transacción, `tx` reutiliza la misma. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/* ---------------- Neon / Postgres ---------------- */

function wrapPgClient(client: pg.PoolClient): Db {
  const db: Db = {
    query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
    one: async (sql, params) => (await client.query(sql, params as unknown[])).rows[0],
    exec: async (sql) => void (await client.query(sql)),
    tx: (fn) => fn(db),
    close: async () => {},
  };
  return db;
}

export function openPostgres(url: string): Db {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    ssl: local ? undefined : { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  // Un fallo de una conexión inactiva (p. ej. Neon la cierra) no debe tumbar el servidor.
  pool.on('error', (err) => console.warn(`[bd] conexión cerrada: ${err.message}`));
  return {
    query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
    one: async (sql, params) => (await pool.query(sql, params as unknown[])).rows[0],
    exec: async (sql) => void (await pool.query(sql)),
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrapPgClient(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/* ---------------- PGlite (local y tests) ---------------- */

function wrapLiteTx(t: Transaction): Db {
  const db: Db = {
    query: async (sql, params) => (await t.query(sql, params)).rows as never[],
    one: async (sql, params) => (await t.query(sql, params)).rows[0] as never,
    exec: async (sql) => void (await t.exec(sql)),
    tx: (fn) => fn(db),
    close: async () => {},
  };
  return db;
}

/** `dataDir` = carpeta donde guardar los datos; sin ella, en memoria (tests). */
export function openPGlite(dataDir?: string): Db {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const lite = new PGlite(dataDir);
  return {
    query: async (sql, params) => (await lite.query(sql, params)).rows as never[],
    one: async (sql, params) => (await lite.query(sql, params)).rows[0] as never,
    exec: async (sql) => void (await lite.exec(sql)),
    tx: (fn) => lite.transaction((t) => fn(wrapLiteTx(t))),
    close: () => lite.close(),
  };
}

/* ---------------- Migraciones ---------------- */

/** Aplica las migraciones pendientes (tabla schema_migrations). */
export async function migrate(db: Db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const row = await db.one<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  for (let v = row?.v ?? 0; v < migrations.length; v++) {
    await db.tx(async (t) => {
      await t.exec(migrations[v]!);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [v + 1]);
    });
  }
}

/** Abre la base de datos según la configuración y la deja migrada. */
export async function openDatabase(opts: { url?: string | null; dataDir?: string | null }): Promise<Db> {
  const db = opts.url ? openPostgres(opts.url) : openPGlite(opts.dataDir ?? undefined);
  await migrate(db);
  return db;
}

/** Fechas de Postgres (Date) a texto ISO, como las espera la API. */
export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
