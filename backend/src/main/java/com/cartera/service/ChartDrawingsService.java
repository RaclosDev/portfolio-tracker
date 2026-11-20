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

    /** Lo guardado, o una lista vacía si no hay nada o ya no se entiende. */
    @Transactional(readOnly = true)
    public List<ChartDrawing> get(UUID userId, String symbol) {
        return repository.findById(new ChartDrawings.Key(userId, key(symbol)))
                .map(row -> {
                    try {
                        return parse(json.readTree(row.getDrawings()));
                    } catch (JacksonException | ApiException e) {
                        log.warn("Dibujos de {} ilegibles: {}", symbol, e.getMessage());
                        return List.<ChartDrawing>of();
                    }
                })
                .orElse(List.of());
    }

    /** Sustituye todos los dibujos del valor. */
    @Transactional
    public List<ChartDrawing> save(UUID userId, String symbol, JsonNode body) {
        List<ChartDrawing> drawings = parse(body);
        ChartDrawings row = repository.findById(new ChartDrawings.Key(userId, key(symbol))).orElseGet(() -> {
            ChartDrawings d = new ChartDrawings();
            d.setUserId(userId);
            d.setSymbol(key(symbol));
            return d;
        });
        row.setDrawings(json.writeValueAsString(drawings));
        repository.save(row);
        return drawings;
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
