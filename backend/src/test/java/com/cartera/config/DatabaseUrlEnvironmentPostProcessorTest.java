package com.cartera.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseUrlEnvironmentPostProcessorTest {

    @Test
    void neonUrlBecomesJdbcWithCredentials() {
        var props = DatabaseUrlEnvironmentPostProcessor.toDatasource(
                "postgresql://neondb_owner:a%2Fb+c@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");
        assertThat(props)
                .containsEntry("spring.datasource.url",
                        "jdbc:postgresql://ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require")
                .containsEntry("spring.datasource.username", "neondb_owner")
                .containsEntry("spring.datasource.password", "a/b+c");
    }

    @Test
    void keepsPortAndLeavesJdbcUrlsAlone() {
        assertThat(DatabaseUrlEnvironmentPostProcessor.toDatasource("postgres://u:p@localhost:5434/cartera"))
                .containsEntry("spring.datasource.url", "jdbc:postgresql://localhost:5434/cartera");
        assertThat(DatabaseUrlEnvironmentPostProcessor.toDatasource("jdbc:postgresql://localhost:5434/cartera")).isEmpty();
        assertThat(DatabaseUrlEnvironmentPostProcessor.toDatasource(null)).isEmpty();
    }
}
