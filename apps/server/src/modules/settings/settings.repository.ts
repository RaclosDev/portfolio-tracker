import { settingsSchema, type Settings } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';

export class SettingsRepository {
  constructor(private db: Db) {}

  async get(): Promise<Settings> {
    const rows = await this.db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
    const parsed = settingsSchema.safeParse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    return parsed.success ? parsed.data : settingsSchema.parse({});
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = settingsSchema.parse({ ...(await this.get()), ...patch });
    await this.db.tx(async (t) => {
      for (const [k, v] of Object.entries(next)) {
        await t.query(
          'INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [k, JSON.stringify(v)],
        );
      }
    });
    return next;
  }
}

/** Estado interno clave/valor (memoria de avisos, fechas de la última tarea…). */
export class StateRepository {
  constructor(private db: Db) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.one<{ value: T }>('SELECT value FROM app_state WHERE key = $1', [key]);
    return row ? row.value : fallback;
  }

  async set(key: string, value: unknown) {
    await this.db.query(
      'INSERT INTO app_state (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
  }
}
