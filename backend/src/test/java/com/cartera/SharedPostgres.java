package com.cartera;

import org.testcontainers.containers.PostgreSQLContainer;

/** Un único PostgreSQL por JVM de test: todas las clases @SpringBootTest comparten contenedor y contexto. */
public final class SharedPostgres {

    private static PostgreSQLContainer<?> container;

    private SharedPostgres() {
    }

    public static synchronized PostgreSQLContainer<?> get() {
        if (container == null) {
            container = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withTmpFs(java.util.Map.of("/var/lib/postgresql/data", "rw"))
                    .withCommand("postgres", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off");
            container.start();
        }
        return container;
    }
}
