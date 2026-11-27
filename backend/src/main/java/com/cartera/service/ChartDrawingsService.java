package com.cartera.service;

import com.cartera.dto.ChartDrawing;
import com.cartera.exception.ApiException;
import com.cartera.model.ChartDrawings;
import com.cartera.repository.ChartDrawingsRepository;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Dibujos del gráfico de velas de cada valor (soportes, resistencias, tendencias, canales). */
@Service
@RequiredArgsConstructor
@Slf4j
public class ChartDrawingsService {

    static final int MAX = 200;
    private static final TypeReference<List<ChartDrawing>> LIST = new TypeReference<>() {
    };

    private final ChartDrawingsRepository repository;
    private final JsonMapper json;
    private final Validator validator;

    /** Los dibujos y la versión con la que se han leído (la que el cliente devuelve al guardar). */
    public record Versioned(List<ChartDrawing> drawings, String version) {
    }

    /** Versión de un valor sin dibujos guardados todavía: distinta de cualquier fila existente. */
    static final String NEW = "new";

    /** Lo guardado, o una lista vacía si no hay nada o ya no se entiende. */
    @Transactional(readOnly = true)
    public Versioned get(UUID userId, String symbol) {
        return repository.findById(new ChartDrawings.Key(userId, key(symbol)))
                .map(row -> {
                    try {
                        return new Versioned(parse(json.readTree(row.getDrawings())), version(row));
                    } catch (JacksonException | ApiException e) {
                        log.warn("Dibujos de {} ilegibles: {}", symbol, e.getMessage());
                        return new Versioned(List.<ChartDrawing>of(), version(row));
                    }
                })
                .orElse(new Versioned(List.of(), NEW));
    }

    /**
     * Sustituye todos los dibujos del valor. Si llega {@code ifMatch} (la versión con la que el cliente leyó la lista)
     * y ya no es la actual, es un conflicto (409): otro dispositivo ha guardado después y no se le pisa en silencio.
     */
    @Transactional
    public Versioned save(UUID userId, String symbol, JsonNode body, String ifMatch) {
        List<ChartDrawing> drawings = parse(body);
        ChartDrawings existing = repository.findById(new ChartDrawings.Key(userId, key(symbol))).orElse(null);
        String current = existing == null ? NEW : version(existing);
        if (ifMatch != null && !matches(ifMatch, current)) {
            throw ApiException.conflict("Los dibujos de este valor han cambiado en otro sitio. Se han recargado; vuelve a hacer el cambio.");
        }
        ChartDrawings row = existing;
        if (row == null) {
            row = new ChartDrawings();
            row.setUserId(userId);
            row.setSymbol(key(symbol));
        }
        row.setDrawings(json.writeValueAsString(drawings));
        // saveAndFlush: la versión nueva (y un posible choque con otra petición a la vez) se conoce ya.
        row = repository.saveAndFlush(row);
        return new Versioned(drawings, version(row));
    }

    private static String version(ChartDrawings row) {
        return String.valueOf(row.getVersion());
    }

    /** Compara con la cabecera If-Match: admite comillas, el prefijo débil {@code W/} y {@code *}. */
    private static boolean matches(String ifMatch, String current) {
        String value = ifMatch.trim();
        if (value.equals("*")) return true;
        if (value.startsWith("W/")) value = value.substring(2);
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.substring(1, value.length() - 1);
        return value.equals(current);
    }

    private List<ChartDrawing> parse(JsonNode body) {
        if (body == null || !body.isArray()) throw ApiException.badRequest("Los dibujos tienen que ser una lista.");
        if (body.size() > MAX) throw ApiException.badRequest("Como mucho " + MAX + " dibujos por valor.");
        ArrayNode upgraded = json.createArrayNode();
        body.forEach(d -> upgraded.add(upgrade(d)));
        List<ChartDrawing> drawings;
        try {
            drawings = json.convertValue(upgraded, LIST);
        } catch (IllegalArgumentException | JacksonException e) {
            throw ApiException.badRequest("Los dibujos no son válidos.");
        }
        for (ChartDrawing d : drawings) {
            if (d == null) throw ApiException.badRequest("Dibujo no válido (vacío).");
            Set<ConstraintViolation<ChartDrawing>> errors = validator.validate(d);
            if (!errors.isEmpty()) {
                ConstraintViolation<ChartDrawing> first = errors.iterator().next();
                String field = first.getPropertyPath().toString();
                String why = field.isEmpty() || field.startsWith("pointCount") ? first.getMessage() : field + ": " + first.getMessage();
                throw ApiException.badRequest("Dibujo no válido (" + why + ").");
            }
        }
        return drawings;
    }

    /** Las líneas horizontales de antes guardaban {@code price} en vez de un punto. */
    private JsonNode upgrade(JsonNode d) {
        if (d instanceof ObjectNode o && o.has("price") && !o.has("points")) {
            ObjectNode copy = o.deepCopy();
            JsonNode price = copy.remove("price");
            copy.putArray("points").addObject().put("t", "1970-01-01").set("p", price);
            return copy;
        }
        return d;
    }

    private static String key(String symbol) {
        return symbol.trim().toUpperCase(Locale.ROOT);
    }
}
