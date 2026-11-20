package com.cartera.util;

import com.cartera.exception.ApiException;
import com.cartera.exception.InvalidDataException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Cambios parciales sobre JSON: se aplican sobre el objeto completo actual y el resultado se
 * convierte y valida como si hubiera llegado entero.
 */
@Component
@RequiredArgsConstructor
public class JsonPatches {

    private final JsonMapper json;
    private final Validator validator;

    public ObjectNode tree(Object value) {
        return json.valueToTree(value);
    }

    /**
     * Fusión recursiva (JSON Merge Patch, RFC 7386) limitada a la forma de {@code target}: las claves
     * desconocidas se descartan y un {@code null} devuelve la clave a su valor de {@code defaults}.
     */
    public static void mergeDeep(ObjectNode target, JsonNode patch, JsonNode defaults) {
        if (patch == null || !patch.isObject()) return;
        for (Map.Entry<String, JsonNode> e : patch.properties()) {
            String key = e.getKey();
            JsonNode value = e.getValue();
            JsonNode current = target.get(key);
            if (current == null) continue;
            if (value.isNull()) {
                target.set(key, defaults.get(key).deepCopy());
            } else if (current.isObject() && value.isObject()) {
                mergeDeep((ObjectNode) current, value, defaults.get(key));
            } else {
                target.set(key, value.deepCopy());
            }
        }
    }

    /** Fusión de un nivel: cada clave conocida se sustituye tal cual, también por {@code null}. */
    public static void mergeShallow(ObjectNode target, JsonNode patch) {
        if (patch == null || !patch.isObject()) return;
        for (Map.Entry<String, JsonNode> e : patch.properties()) {
            if (target.has(e.getKey())) target.set(e.getKey(), e.getValue().deepCopy());
        }
    }

    /** Convierte y valida; {@code prefix} (p. ej. «Fila 3») encabeza cada error. */
    public <T> T convert(JsonNode node, Class<T> type, String prefix) {
        T value;
        try {
            value = json.treeToValue(node, type);
        } catch (JacksonException e) {
            String where = e.getPath().isEmpty() ? "" : e.getPath().getLast().getPropertyName();
            String label = label(prefix, where);
            throw ApiException.badRequest(label.isEmpty() ? "La petición no es válida." : label + "tipo de dato no válido");
        }
        Set<ConstraintViolation<T>> violations = validator.validate(value);
        if (!violations.isEmpty()) {
            List<String> issues = violations.stream()
                    .sorted(Comparator.comparing(v -> v.getPropertyPath().toString()))
                    .map(v -> label(prefix, v.getPropertyPath().toString()) + v.getMessage())
                    .toList();
            throw new InvalidDataException(issues);
        }
        return value;
    }

    public <T> Set<ConstraintViolation<T>> violations(T value) {
        return validator.validate(value);
    }

    public <T> T read(String text, Class<T> type) {
        return json.readValue(text, type);
    }

    public JsonNode readTree(String text) {
        return json.readTree(text);
    }

    public String write(Object value) {
        return json.writeValueAsString(value);
    }

    private static String label(String prefix, String field) {
        String p = prefix == null ? "" : prefix + " · ";
        return field == null || field.isEmpty() ? p : p + field + ": ";
    }
}
