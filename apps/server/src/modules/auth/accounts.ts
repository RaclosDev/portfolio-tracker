import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { migrate, type Db } from '../../db/database.ts';
import { schemaDatabase } from '../../db/scoped.ts';

export interface Account {
  id: string;
  email: string;
  db_schema: string;
  password_hash: string | null;
  google_subject: string | null;
}

const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error); else resolve(key);
  });
});

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string) {
  const [algorithm, salt, value] = hash.split(':');
  if (algorithm !== 'scrypt' || !salt || !value) return false;
  const expected = Buffer.from(value, 'hex');
  const actual = await derive(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class Accounts {
  constructor(readonly db: Db) {}

  async initialize(email: string, password: string) {
    await this.db.exec(`
      CREATE SCHEMA IF NOT EXISTS watchlist_auth;
      CREATE TABLE IF NOT EXISTS watchlist_auth.accounts (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
        password_hash TEXT,
        google_subject TEXT UNIQUE,
        db_schema TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS watchlist_auth.sessions (
        token_hash TEXT PRIMARY KEY,
        account_id UUID NOT NULL REFERENCES watchlist_auth.accounts(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_account ON watchlist_auth.sessions(account_id);
    `);
    const owner = await this.db.one<Account>("SELECT * FROM watchlist_auth.accounts WHERE db_schema = 'public'");
    if (!owner) {
      await this.db.query(`INSERT INTO watchlist_auth.accounts (id, email, password_hash, db_schema)
        VALUES ($1, $2, $3, 'public') ON CONFLICT (db_schema) DO NOTHING`, [randomUUID(), email, await hashPassword(password)]);
    } else if (owner.email !== email) {
      throw new Error('APP_OWNER_EMAIL no coincide con la cuenta propietaria existente.');
    }
    await this.db.query('DELETE FROM watchlist_auth.sessions WHERE expires_at <= now()');
    for (const account of await this.all()) {
      if (account.db_schema !== 'public') await migrate(schemaDatabase(this.db, account.db_schema));
    }
  }

  all() { return this.db.query<Account>('SELECT * FROM watchlist_auth.accounts ORDER BY created_at'); }
  byEmail(email: string) { return this.db.one<Account>('SELECT * FROM watchlist_auth.accounts WHERE email = $1', [email]); }
  byGoogle(subject: string) { return this.db.one<Account>('SELECT * FROM watchlist_auth.accounts WHERE google_subject = $1', [subject]); }

  async create(email: string, passwordHash: string | null, googleSubject: string | null = null) {
    const id = randomUUID();
    const schema = `account_${id.replaceAll('-', '')}`;
    return this.db.tx(async (db) => {
      const account = await db.one<Account>(`INSERT INTO watchlist_auth.accounts
        (id, email, password_hash, google_subject, db_schema) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, email, passwordHash, googleSubject, schema]);
      await db.exec(`CREATE SCHEMA "${schema}"`);
      await migrate(schemaDatabase(db, schema));
      return account!;
    });
  }

  async linkGoogle(accountId: string, subject: string) {
    return this.db.one<Account>(`UPDATE watchlist_auth.accounts SET google_subject = $2
      WHERE id = $1 AND (google_subject IS NULL OR google_subject = $2) RETURNING *`, [accountId, subject]);
  }
}
