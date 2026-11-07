import { settingsSchema, type Settings } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';

export class SettingsRepository {
  constructor(private db: Db) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const raw = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    const parsed = settingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : settingsSchema.parse({});
  }

  update(patch: Partial<Settings>): Settings {
    const next = settingsSchema.parse({ ...this.get(), ...patch });
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const [k, v] of Object.entries(next)) stmt.run(k, JSON.stringify(v));
    return next;
  }
}
