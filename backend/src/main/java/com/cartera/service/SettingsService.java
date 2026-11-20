package com.cartera.service;

import com.cartera.dto.Settings;
import com.cartera.exception.ApiException;
import com.cartera.model.UserSettings;
import com.cartera.repository.UserSettingsRepository;
import com.cartera.util.JsonPatches;
import jakarta.validation.ConstraintViolation;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** Ajustes del usuario: lo guardado sobre los valores de serie, y cambios parciales con PATCH. */
@Service
@RequiredArgsConstructor
@Slf4j
public class SettingsService {

    private final UserSettingsRepository repository;
    private final JsonPatches patches;

    @Transactional(readOnly = true)
    public Settings get(UUID userId) {
        return repository.findById(userId).map(row -> read(userId, row.getData())).orElse(Settings.DEFAULTS);
    }

    /** Aplica {@code patch} con la semántica de JSON Merge Patch: un {@code null} vuelve al valor de serie. */
    @Transactional
    public Settings update(UUID userId, JsonNode patch) {
        if (patch == null || !patch.isObject()) throw ApiException.badRequest("La petición no es válida.");
        repository.ensureExists(userId);
        UserSettings row = repository.findForUpdate(userId).orElseThrow();
        ObjectNode next = patches.tree(read(userId, row.getData()));
        JsonPatches.mergeDeep(next, patch, defaults());
        Settings settings = patches.convert(next, Settings.class, null);
        row.setData(patches.write(settings));
        row.setUpdatedAt(Instant.now());
        return settings;
    }

    /**
     * Lo guardado se completa con los valores de serie. Si algún ajuste guardado ya no es válido
     * (cambió el formato en una versión nueva), solo ese vuelve al de serie.
     */
    private Settings read(UUID userId, String data) {
        try {
            ObjectNode tree = defaults();
            JsonPatches.mergeDeep(tree, patches.readTree(data), defaults());
            Settings settings = patches.read(patches.write(tree), Settings.class);
            Set<ConstraintViolation<Settings>> violations = patches.violations(settings);
            if (violations.isEmpty()) return settings;
            ObjectNode fallback = defaults();
            for (ConstraintViolation<Settings> v : violations) {
                String key = v.getPropertyPath().iterator().next().getName();
                tree.set(key, fallback.get(key));
            }
            log.warn("Ajustes de {} no válidos ({}); vuelven a los de serie.", userId, violations.size());
            return patches.read(patches.write(tree), Settings.class);
        } catch (RuntimeException e) {
            log.warn("Ajustes de {} ilegibles; se usan los de serie.", userId, e);
            return Settings.DEFAULTS;
        }
    }

    private ObjectNode defaults() {
        return patches.tree(Settings.DEFAULTS);
    }
}
