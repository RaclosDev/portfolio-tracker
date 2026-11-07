/**
 * Migraciones en orden. Nunca edites una ya publicada: añade una nueva al final.
 * El índice + 1 es la versión que queda en PRAGMA user_version.
 */
export const migrations: string[] = [
  /* 1 — esquema inicial */ `
  CREATE TABLE lists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE items (
    id              INTEGER PRIMARY KEY,
    list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    name            TEXT,
    buy_prices      TEXT NOT NULL DEFAULT '[]',
    broker_target   REAL,
    broker_name     TEXT,
    invest_amount   REAL,
    shares_override INTEGER,
    order_active    INTEGER NOT NULL DEFAULT 0,
    order_price     REAL,
    order_until     TEXT,
    notes           TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (list_id, symbol)
  );
  CREATE INDEX items_list ON items(list_id, position);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Último dato conocido de mercado (fallback sin conexión y caché entre reinicios)
  CREATE TABLE market_cache (
    kind       TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    data       TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (kind, symbol)
  );

  INSERT INTO lists (name) VALUES ('Vigilar nuevas');
  `,

  /* 2 — silenciar avisos de un valor */ `
  ALTER TABLE items ADD COLUMN muted_until TEXT;
  `,

  /* 3 — cartera real */ `
  CREATE TABLE positions (
    id          INTEGER PRIMARY KEY,
    symbol      TEXT NOT NULL UNIQUE,
    name        TEXT,
    shares      REAL NOT NULL,
    avg_price   REAL NOT NULL,
    cost_base   REAL,
    buy_date    TEXT,
    sell_target REAL,
    notes       TEXT,
    muted_until TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];
