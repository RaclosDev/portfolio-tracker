package com.cartera.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.sql.Timestamp;
import java.util.List;

/**
 * Último dato conocido de cada consulta de mercado (cotización, histórico, consenso…), compartido entre usuarios.
 * Si la base de datos falla se sigue sin ella: la caché en memoria y las fuentes bastan.
 */
@Repository
@RequiredArgsConstructor
@Slf4j
public class MarketCacheRepository {

    public record Row(JsonNode data, long fetchedAtMillis) {
    }

    private final JdbcTemplate jdbc;
    private final JsonMapper json;

    public void save(String kind, String symbol, Object value) {
        try {
            jdbc.update("""
                    INSERT INTO market_cache (kind, symbol, data, fetched_at) VALUES (?, ?, ?::jsonb, now())
                    ON CONFLICT (kind, symbol) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at""",
                    kind, symbol, json.writeValueAsString(value));
        } catch (DataAccessException e) {
            log.warn("No se pudo guardar {} de {}: {}", kind, symbol, e.getMessage());
        }
    }

    /** El dato guardado (puede ser el JSON {@code null}: «la fuente no tiene») o null si no hay fila. */
    public Row find(String kind, String symbol) {
        try {
            List<Row> rows = jdbc.query("SELECT data::text, fetched_at FROM market_cache WHERE kind = ? AND symbol = ?",
                    (rs, i) -> new Row(json.readTree(rs.getString(1)), toMillis(rs.getTimestamp(2))), kind, symbol);
            return rows.isEmpty() ? null : rows.getFirst();
        } catch (DataAccessException e) {
            log.warn("No se pudo leer {} de {}: {}", kind, symbol, e.getMessage());
            return null;
        }
    }

    private static long toMillis(Timestamp t) {
        return t == null ? 0 : t.getTime();
    }
}
