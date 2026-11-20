package com.cartera.service.alerts;

import com.cartera.model.AlertState;
import com.cartera.model.User;
import com.cartera.repository.AlertStateRepository;
import com.cartera.repository.UserRepository;
import com.cartera.service.SettingsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * Repaso de avisos de todos los usuarios. Se despierta cada minuto y comprueba a quien le toca según la frecuencia
 * de sus Ajustes (como mínimo un minuto).
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnBooleanProperty("app.alerts.scheduler-enabled")
public class AlertScheduler {

    private static final int MIN_INTERVAL_S = 60;

    private final UserRepository users;
    private final AlertStateRepository states;
    private final SettingsService settings;
    private final AlertService alerts;

    @Scheduled(initialDelay = 5_000, fixedDelay = 60_000)
    public void run() {
        for (User user : users.findAll()) {
            UUID id = user.getId();
            try {
                Duration interval = Duration.ofSeconds(Math.max(MIN_INTERVAL_S, settings.get(id).refreshSeconds()));
                Instant last = states.findById(id).map(AlertState::getLastCheckedAt).orElse(null);
                Instant now = Instant.now();
                if (last != null && Duration.between(last, now).compareTo(interval) < 0) continue;
                alerts.tick(id, now, false, true);
            } catch (RuntimeException e) {
                log.warn("No se pudo comprobar los avisos de un usuario", e);
            }
        }
    }
}
