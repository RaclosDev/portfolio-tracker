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

    /** Las filas guardadas de varios símbolos de una vez (los que no tienen fila no salen). */
    public java.util.Map<String, Row> findAll(String kind, List<String> symbols) {
        java.util.Map<String, Row> out = new java.util.HashMap<>();
        if (symbols.isEmpty()) return out;
        String marks = String.join(",", java.util.Collections.nCopies(symbols.size(), "?"));
        Object[] args = new Object[symbols.size() + 1];
        args[0] = kind;
        for (int i = 0; i < symbols.size(); i++) args[i + 1] = symbols.get(i);
        try {
            jdbc.query("SELECT symbol, data::text, fetched_at FROM market_cache WHERE kind = ? AND symbol IN (" + marks + ")",
                    rs -> {
                        out.put(rs.getString(1), new Row(json.readTree(rs.getString(2)), toMillis(rs.getTimestamp(3))));
                    }, args);
        } catch (DataAccessException e) {
            log.warn("No se pudo leer {}: {}", kind, e.getMessage());
        }
        return out;
    }

    private static long toMillis(Timestamp t) {
        return t == null ? 0 : t.getTime();
    }
}
