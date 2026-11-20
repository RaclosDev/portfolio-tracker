package com.cartera.service.alerts;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.UUID;

/**
 * Repaso de avisos de todos los usuarios, cada pocos segundos ({@code app.alerts.interval-seconds}). Trabaja con los
 * datos en memoria de {@link AlertWorkset} y los precios del proveedor: una vuelta sin novedades no toca la base de
 * datos, así que esta puede dormirse aunque el vigilante no pare.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnBooleanProperty("app.alerts.scheduler-enabled")
public class AlertScheduler {

    private final AlertService alerts;
    private final AlertWorkset workset;

    @Value("${app.alerts.interval-seconds:10}")
    private long intervalSeconds;

    @Scheduled(initialDelay = 5_000, fixedDelayString = "${app.alerts.interval-seconds:10}", timeUnit = java.util.concurrent.TimeUnit.SECONDS)
    public void run() {
        // Los precios pueden tener como mucho lo que dura una vuelta: así cada vuelta trae precios nuevos.
        long maxAgeMs = Math.max(1, intervalSeconds) * 1000 - 500;
        for (UUID id : workset.users()) {
            try {
                alerts.tick(id, Instant.now(), false, maxAgeMs);
            } catch (RuntimeException e) {
                log.warn("No se pudo comprobar los avisos de un usuario", e);
            }
        }
    }

    /** Recarga de seguridad: por si algún cambio no pasó por la API (p. ej. a mano en la base de datos). */
    @Scheduled(initialDelay = 6, fixedDelay = 6, timeUnit = java.util.concurrent.TimeUnit.HOURS)
    public void reload() {
        workset.reloadAll();
    }
}
