/**
 * Migraciones de PostgreSQL, en orden. Nunca edites una ya publicada: añade una nueva al final.
 * Las fechas de calendario (orden hasta, compra…) se guardan como texto AAAA-MM-DD para que no
 * cambien con la zona horaria.
 */
export const migrations: string[] = [
  /* 1: esquema inicial de la versión web */ `
  CREATE TABLE lists (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE items (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    name            TEXT,
    buy_prices      JSONB NOT NULL DEFAULT '[]',
    broker_target   DOUBLE PRECISION,
    broker_name     TEXT,
    invest_amount   DOUBLE PRECISION,
    shares_override INTEGER,
    order_active    BOOLEAN NOT NULL DEFAULT false,
    order_price     DOUBLE PRECISION,
    order_until     TEXT,
    notes           TEXT,
    muted_until     TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (list_id, symbol)
  );
  CREATE INDEX items_list ON items(list_id, position);

  CREATE TABLE positions (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol      TEXT NOT NULL UNIQUE,
    name        TEXT,
    shares      DOUBLE PRECISION NOT NULL,
    avg_price   DOUBLE PRECISION NOT NULL,
    cost_base   DOUBLE PRECISION,
    buy_date    TEXT,
    sell_target DOUBLE PRECISION,
    notes       TEXT,
    muted_until TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
  );

  -- Último dato conocido de mercado (si Yahoo falla y caché entre reinicios)
  CREATE TABLE market_cache (
    kind       TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    data       JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (kind, symbol)
  );

  -- Estado interno (memoria de avisos, último resumen diario, última copia…)
  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
  );

  CREATE TABLE alert_history (
    id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind    TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    symbol  TEXT NOT NULL,
    title   TEXT NOT NULL,
    body    TEXT NOT NULL
  );

  -- Dispositivos que reciben notificaciones (Web Push)
  CREATE TABLE push_subscriptions (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    label      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ok_at TIMESTAMPTZ
  );

  -- Copias de seguridad dentro de la propia base de datos (diarias y antes de importar)
  CREATE TABLE snapshots (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason     TEXT NOT NULL,
    data       JSONB NOT NULL
  );

  INSERT INTO lists (name) VALUES ('Vigilar nuevas');
  `,
];
