-- Esquema inicial de Cartera. Todos los datos de usuario cuelgan de users(id).

CREATE TABLE users (
    id             UUID PRIMARY KEY,
    email          VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(trim(email))),
    password_hash  VARCHAR(255),
    google_subject VARCHAR(255) UNIQUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesiones: refresh token opaco y rotatorio. Cada inicio de sesión abre una familia (family_id); un
-- token ya rotado que vuelve a llegar fuera del margen revoca la familia entera.
CREATE TABLE refresh_tokens (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id  UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    rotated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_family ON refresh_tokens(family_id);

-- Preferencias de la interfaz y de los avisos: un documento por usuario.
CREATE TABLE user_settings (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE watch_lists (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(60) NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE TABLE watch_items (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    list_id         BIGINT NOT NULL REFERENCES watch_lists(id) ON DELETE CASCADE,
    symbol          VARCHAR(32) NOT NULL,
    ticker          VARCHAR(32),
    isin            VARCHAR(12),
    name            VARCHAR(120),
    buy_prices      DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
    broker_target   DOUBLE PRECISION,
    broker_name     VARCHAR(40),
    invest_amount   DOUBLE PRECISION,
    shares_override INTEGER,
    order_active    BOOLEAN NOT NULL DEFAULT false,
    order_price     DOUBLE PRECISION,
    order_until     DATE,
    notes           TEXT,
    -- Avisos silenciados hasta esta fecha (incluida) o para siempre.
    muted_until     DATE,
    muted_forever   BOOLEAN NOT NULL DEFAULT false,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (list_id, symbol)
);
CREATE INDEX watch_items_list ON watch_items(list_id, position);

CREATE TABLE instruments (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker     VARCHAR(32) NOT NULL,
    symbol     VARCHAR(32),
    name       VARCHAR(120),
    sector     VARCHAR(80),
    currency   CHAR(3) NOT NULL DEFAULT 'EUR',
    isin       VARCHAR(12),
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, ticker)
);

CREATE TABLE operations (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    ticker              VARCHAR(32) NOT NULL,
    type                VARCHAR(20) NOT NULL,
    shares              DOUBLE PRECISION,
    price               DOUBLE PRECISION,
    fees                DOUBLE PRECISION NOT NULL DEFAULT 0,
    fx_rate             DOUBLE PRECISION NOT NULL DEFAULT 1,
    amount_eur          DOUBLE PRECISION NOT NULL,
    withholding_es      DOUBLE PRECISION,
    withholding_foreign DOUBLE PRECISION,
    split_ratio         DOUBLE PRECISION,
    broker              VARCHAR(40),
    notes               TEXT,
    needs_review        BOOLEAN NOT NULL DEFAULT false,
    source              VARCHAR(10) NOT NULL DEFAULT 'manual',
    source_ref          INTEGER,
    lot_ref             INTEGER,
    day_order           INTEGER,
    transfer_ref        VARCHAR(100),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX operations_user_ticker ON operations(user_id, ticker, date, id);

CREATE TABLE alert_history (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind    VARCHAR(20) NOT NULL,
    item_id BIGINT NOT NULL,
    symbol  VARCHAR(32) NOT NULL,
    title   TEXT NOT NULL,
    body    TEXT NOT NULL
);
CREATE INDEX alert_history_user ON alert_history(user_id, at DESC);

-- Estado de la tarea de avisos de cada usuario: qué se ha avisado ya y cuándo fue la última vez.
CREATE TABLE alert_state (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    memory          JSONB NOT NULL DEFAULT '{}',
    last_summary_on DATE,
    last_backup_on  DATE,
    last_checked_at TIMESTAMPTZ
);

-- Órdenes activas a cuyo precio ha llegado la cotización, pendientes de apuntar o descartar.
CREATE TABLE touched_orders (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     BIGINT NOT NULL REFERENCES watch_items(id) ON DELETE CASCADE,
    order_price DOUBLE PRECISION NOT NULL,
    price       DOUBLE PRECISION NOT NULL,
    currency    VARCHAR(3) NOT NULL DEFAULT 'EUR',
    shares      DOUBLE PRECISION,
    touched_at  TIMESTAMPTZ NOT NULL,
    dismissed   BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (item_id, order_price)
);

-- Valores abiertos desde el buscador («Visitados»).
CREATE TABLE visited_symbols (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol     VARCHAR(32) NOT NULL,
    name       VARCHAR(200) NOT NULL,
    exchange   VARCHAR(80),
    type       VARCHAR(40),
    isin       VARCHAR(12),
    visited_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, symbol)
);

-- Dibujos del gráfico de velas de cada valor.
CREATE TABLE chart_drawings (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol   VARCHAR(32) NOT NULL,
    drawings JSONB NOT NULL,
    PRIMARY KEY (user_id, symbol)
);

-- Dispositivos que reciben notificaciones (Web Push).
CREATE TABLE push_subscriptions (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    label      VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ok_at TIMESTAMPTZ
);

-- Copias de seguridad dentro de la base de datos (diarias y antes de importar).
CREATE TABLE snapshots (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason     VARCHAR(40) NOT NULL,
    data       JSONB NOT NULL
);
CREATE INDEX snapshots_user ON snapshots(user_id, created_at DESC);

-- Último dato conocido de cada fuente de mercado (común a todos: son datos públicos).
CREATE TABLE market_cache (
    kind       VARCHAR(20) NOT NULL,
    symbol     VARCHAR(64) NOT NULL,
    data       JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (kind, symbol)
);
