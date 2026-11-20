-- Importa los datos de la versión anterior (un esquema por cuenta: el titular en «public», el resto en
-- «account_<hex>», y las cuentas en watchlist_auth). Sin watchlist_auth (instalación local de un solo
-- usuario) se importa «public» como titular, con el correo de APP_OWNER_EMAIL y sin contraseña: la pone
-- el primer arranque con APP_PASSWORD. Si no hay datos anteriores, no hace nada.
-- Los esquemas antiguos se quedan como copia hasta retirarlos a mano (solo se les añaden columnas que falten).

CREATE TEMP TABLE legacy_list_map (old_id INTEGER PRIMARY KEY, new_id BIGINT NOT NULL);
CREATE TEMP TABLE legacy_item_map (old_id INTEGER PRIMARY KEY, new_id BIGINT NOT NULL);

-- Las claves de la memoria de avisos llevan el id del valor («12:0:4.5», «order:12:4.5», «expira:12:…»).
CREATE FUNCTION pg_temp.remap_alert_keys(obj JSONB) RETURNS JSONB LANGUAGE sql AS $$
    SELECT COALESCE(jsonb_object_agg(p.m[1] || map.new_id || p.m[3], e.value), '{}'::jsonb)
    FROM jsonb_each(COALESCE(obj, '{}'::jsonb)) e
    CROSS JOIN LATERAL (SELECT regexp_match(e.key, '^((?:order:|expira:)?)(\d+)(:.*)$') AS m) p
    JOIN legacy_item_map map ON map.old_id = p.m[2]::INTEGER
$$;

CREATE FUNCTION pg_temp.iso_date(v TEXT) RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN v ~ '^\d{4}-\d{2}-\d{2}$' THEN v::DATE END
$$;

DO $$
DECLARE
    acc      RECORD;
    s        TEXT;
    accounts TEXT;
BEGIN
    IF to_regclass('watchlist_auth.accounts') IS NOT NULL THEN
        accounts := 'SELECT id, email, password_hash, google_subject, db_schema, created_at
                     FROM watchlist_auth.accounts ORDER BY created_at';
    ELSIF to_regclass('public.lists') IS NOT NULL THEN
        accounts := format('SELECT gen_random_uuid() AS id, %L::TEXT AS email, NULL::TEXT AS password_hash,
                            NULL::TEXT AS google_subject, %L::TEXT AS db_schema, now() AS created_at',
                           lower(trim('${owner_email}')), 'public');
    ELSE
        RETURN;
    END IF;

    FOR acc IN EXECUTE accounts LOOP
        s := acc.db_schema;
        CONTINUE WHEN to_regclass(format('%I.lists', s)) IS NULL;
        TRUNCATE legacy_list_map, legacy_item_map;

        -- Un esquema que no llegó a las últimas migraciones de la versión anterior: columnas que faltan, vacías.
        EXECUTE format($q$
            ALTER TABLE %1$I.items ADD COLUMN IF NOT EXISTS ticker TEXT, ADD COLUMN IF NOT EXISTS isin TEXT;
            ALTER TABLE %1$I.operations ADD COLUMN IF NOT EXISTS lot_ref INTEGER,
                ADD COLUMN IF NOT EXISTS day_order INTEGER, ADD COLUMN IF NOT EXISTS transfer_ref TEXT
        $q$, s);

        INSERT INTO users (id, email, password_hash, google_subject, created_at)
        VALUES (acc.id, acc.email, acc.password_hash, acc.google_subject, acc.created_at);

        EXECUTE format($q$
            INSERT INTO user_settings (user_id, data)
            SELECT $1, COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) FROM %I.settings
        $q$, s) USING acc.id;

        -- Listas y valores
        EXECUTE format($q$
            WITH ins AS (
                INSERT INTO watch_lists (user_id, name, position, created_at)
                SELECT $1, name, position, created_at FROM %1$I.lists ORDER BY id
                RETURNING id, name
            )
            INSERT INTO legacy_list_map SELECT l.id, ins.id FROM ins JOIN %1$I.lists l ON l.name = ins.name
        $q$, s) USING acc.id;

        EXECUTE format($q$
            WITH ins AS (
                INSERT INTO watch_items (list_id, symbol, ticker, isin, name, buy_prices, broker_target, broker_name,
                    invest_amount, shares_override, order_active, order_price, order_until, notes, muted_until,
                    muted_forever, position, created_at, updated_at)
                SELECT m.new_id, i.symbol, i.ticker, i.isin, i.name,
                    ARRAY(SELECT jsonb_array_elements_text(i.buy_prices)::DOUBLE PRECISION),
                    i.broker_target, i.broker_name, i.invest_amount, i.shares_override, i.order_active, i.order_price,
                    pg_temp.iso_date(i.order_until), i.notes, pg_temp.iso_date(i.muted_until),
                    COALESCE(i.muted_until = 'always', false), i.position, i.created_at, i.updated_at
                FROM %1$I.items i JOIN legacy_list_map m ON m.old_id = i.list_id
                ORDER BY i.id
                RETURNING id, list_id, symbol
            )
            INSERT INTO legacy_item_map
            SELECT i.id, ins.id FROM ins
            JOIN legacy_list_map m ON m.new_id = ins.list_id
            JOIN %1$I.items i ON i.list_id = m.old_id AND i.symbol = ins.symbol
        $q$, s);

        -- Cartera
        EXECUTE format($q$
            INSERT INTO instruments (user_id, ticker, symbol, name, sector, currency, isin, notes, created_at, updated_at)
            SELECT $1, ticker, symbol, name, sector, upper(currency), isin, notes, created_at, updated_at
            FROM %I.instruments ORDER BY created_at, ticker
        $q$, s) USING acc.id;

        EXECUTE format($q$
            INSERT INTO operations (user_id, date, ticker, type, shares, price, fees, fx_rate, amount_eur,
                withholding_es, withholding_foreign, split_ratio, broker, notes, needs_review, source, source_ref,
                lot_ref, day_order, transfer_ref, created_at, updated_at)
            SELECT $1, date::DATE, ticker, type, shares, price, fees, fx_rate, amount_eur, withholding_es,
                withholding_foreign, split_ratio, broker, notes, needs_review, source, source_ref, lot_ref, day_order,
                transfer_ref, created_at, updated_at
            FROM %I.operations ORDER BY id
        $q$, s) USING acc.id;

        -- Avisos, dispositivos y copias
        EXECUTE format($q$
            INSERT INTO alert_history (user_id, at, kind, item_id, symbol, title, body)
            SELECT $1, h.at, h.kind, COALESCE(m.new_id, h.item_id), h.symbol, h.title, h.body
            FROM %I.alert_history h LEFT JOIN legacy_item_map m ON m.old_id = h.item_id
            ORDER BY h.id
        $q$, s) USING acc.id;

        EXECUTE format($q$
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label, created_at, last_ok_at)
            SELECT $1, endpoint, p256dh, auth, label, created_at, last_ok_at FROM %I.push_subscriptions ORDER BY id
            ON CONFLICT (endpoint) DO NOTHING
        $q$, s) USING acc.id;

        EXECUTE format($q$
            INSERT INTO snapshots (user_id, created_at, reason, data)
            SELECT $1, created_at, reason, data FROM %I.snapshots ORDER BY id
        $q$, s) USING acc.id;

        -- Estado interno (antes una tabla clave/valor)
        EXECUTE format($q$
            INSERT INTO alert_state (user_id, memory, last_summary_on, last_backup_on, last_checked_at)
            SELECT $1,
                COALESCE((SELECT value || jsonb_build_object(
                            'levels', pg_temp.remap_alert_keys(value -> 'levels'),
                            'notified', pg_temp.remap_alert_keys(value -> 'notified'))
                          FROM %1$I.app_state WHERE key = 'avisos'), '{}'::jsonb),
                (SELECT pg_temp.iso_date(value #>> '{}') FROM %1$I.app_state WHERE key = 'ultimoResumen'),
                (SELECT pg_temp.iso_date(value #>> '{}') FROM %1$I.app_state WHERE key = 'ultimaCopia'),
                (SELECT to_timestamp((value #>> '{}')::DOUBLE PRECISION / 1000)
                   FROM %1$I.app_state WHERE key = 'account-alert-check' AND jsonb_typeof(value) = 'number')
        $q$, s) USING acc.id;

        EXECUTE format($q$
            INSERT INTO touched_orders (user_id, item_id, order_price, price, currency, shares, touched_at, dismissed)
            SELECT $1, m.new_id, (o ->> 'orderPrice')::DOUBLE PRECISION, (o ->> 'price')::DOUBLE PRECISION,
                COALESCE(o ->> 'currency', 'EUR'), (o ->> 'shares')::DOUBLE PRECISION, (o ->> 'at')::TIMESTAMPTZ,
                COALESCE((o ->> 'dismissed')::BOOLEAN, false)
            FROM %I.app_state st
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.value) = 'array' THEN st.value ELSE '[]' END) o
            JOIN legacy_item_map m ON m.old_id = (o ->> 'itemId')::INTEGER
            WHERE st.key = 'ordenesTocadas'
            ON CONFLICT (item_id, order_price) DO NOTHING
        $q$, s) USING acc.id;

        EXECUTE format($q$
            INSERT INTO visited_symbols (user_id, symbol, name, exchange, type, isin, visited_at)
            SELECT DISTINCT ON (upper(v ->> 'symbol')) $1, upper(v ->> 'symbol'), v ->> 'name', v ->> 'exchange',
                v ->> 'type', v ->> 'isin', COALESCE((v ->> 'visitedAt')::TIMESTAMPTZ, now())
            FROM %I.app_state st
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.value) = 'array' THEN st.value ELSE '[]' END) v
            WHERE st.key = 'visited-symbols' AND v ->> 'symbol' IS NOT NULL AND v ->> 'name' IS NOT NULL
            ORDER BY upper(v ->> 'symbol'), v ->> 'visitedAt' DESC
        $q$, s) USING acc.id;

        EXECUTE format($q$
            INSERT INTO chart_drawings (user_id, symbol, drawings)
            SELECT $1, upper(substring(key FROM 'chart-drawings:(.*)')), value
            FROM %I.app_state WHERE key LIKE 'chart-drawings:%%' AND jsonb_typeof(value) = 'array'
        $q$, s) USING acc.id;
    END LOOP;

    -- La caché de mercado es común: se aprovecha la del titular.
    IF to_regclass('public.market_cache') IS NOT NULL THEN
        INSERT INTO market_cache (kind, symbol, data, fetched_at)
        SELECT kind, symbol, data, fetched_at FROM public.market_cache
        ON CONFLICT DO NOTHING;
    END IF;

    -- Ajustes de antes de los cinco tramos: sus colores de estado ya no valen y entran los de serie.
    UPDATE user_settings
    SET data = jsonb_set(data, '{colors}', (data -> 'colors') - 'reached' - 'near' - 'far' - 'veryFar')
    WHERE NOT data ? 'bands' AND jsonb_typeof(data -> 'colors') = 'object';
END $$;
