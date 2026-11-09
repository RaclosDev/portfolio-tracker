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
  /* 2: cartera como registro de operaciones (la tabla de posiciones antigua se conserva sin usar) */ `
  ALTER TABLE positions RENAME TO legacy_positions;

  CREATE TABLE instruments (
    ticker     TEXT PRIMARY KEY,
    symbol     TEXT,
    name       TEXT,
    sector     TEXT,
    currency   TEXT NOT NULL DEFAULT 'EUR',
    isin       TEXT,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE operations (
    id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date                TEXT NOT NULL,
    ticker              TEXT NOT NULL,
    type                TEXT NOT NULL,
    shares              DOUBLE PRECISION,
    price               DOUBLE PRECISION,
    fees                DOUBLE PRECISION NOT NULL DEFAULT 0,
    fx_rate             DOUBLE PRECISION NOT NULL DEFAULT 1,
    amount_eur          DOUBLE PRECISION NOT NULL,
    withholding_es      DOUBLE PRECISION,
    withholding_foreign DOUBLE PRECISION,
    split_ratio         DOUBLE PRECISION,
    broker              TEXT,
    notes               TEXT,
    needs_review        BOOLEAN NOT NULL DEFAULT false,
    source              TEXT NOT NULL DEFAULT 'manual',
    source_ref          INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX operations_ticker ON operations(ticker, date, id);
  `,
  // 3: el scrip del Excel va al lote de su compra (columna «Lote»).
  `ALTER TABLE operations ADD COLUMN lot_ref INTEGER;`,
];
