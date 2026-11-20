package com.cartera.config;

import com.cartera.controller.BootstrapController;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Calienta la app antes de abrir el puerto. Render pasa el tráfico a la instancia nueva en cuanto el puerto acepta
 * conexiones, y con 0,1 CPU la primera visita tras desplegar pagaba la JVM fría: 30 s en cargar. Aquí se construye
 * la primera pantalla de cada cuenta (consultas, cotizaciones a la caché, JSON) mientras la versión anterior sigue
 * atendiendo. El servidor web arranca en una fase posterior, así que espera a que esto termine.
 */
@Component
@ConditionalOnProperty(name = "app.warmup.enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class WarmUp implements SmartLifecycle {

    /** Tope de cuentas y de tiempo: un despliegue no debe quedarse colgado por una fuente de precios lenta. */
    private static final int MAX_USERS = 20;
    private static final long BUDGET_MS = 90_000;

    private final UserRepository users;
    private final BootstrapController bootstrap;
    private final JwtUtil jwt;
    private final JsonMapper json;
    private volatile boolean running;

    @Override
    public void start() {
        long t0 = System.currentTimeMillis();
        int done = 0;
        try {
            for (User u : users.findAll(PageRequest.of(0, MAX_USERS))) {
                if (System.currentTimeMillis() - t0 > BUDGET_MS) break;
                try {
                    jwt.verify(jwt.generateAccessToken(u.getId(), u.getEmail()));
                    json.writeValueAsBytes(bootstrap.get(new CurrentUser(u.getId(), u.getEmail()), null, null));
                    done++;
                } catch (RuntimeException e) {
                    log.warn("Calentamiento: falló la cuenta {}: {}", u.getId(), e.toString());
                }
            }
        } catch (RuntimeException e) {
            log.warn("Calentamiento interrumpido: {}", e.toString());
        }
        log.info("Calentamiento: {} cuentas en {} ms", done, System.currentTimeMillis() - t0);
        running = true;
    }

    @Override
    public void stop() {
        running = false;
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    /** Antes que el servidor web ({@code DEFAULT_PHASE - 2048}): el puerto no se abre hasta acabar. */
    @Override
    public int getPhase() {
        return 0;
    }
}
