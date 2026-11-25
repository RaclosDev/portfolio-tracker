package com.cartera;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.endsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** La web compilada: rutas de la SPA a index.html, assets con caché larga y 404 de verdad para lo que no existe. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.jwt.secret=integration-test-secret-0123456789-abcdefghijklmnop",
        "app.rate-limiting.enabled=false"})
@Testcontainers(disabledWithoutDocker = true)
class SpaWebTest {

    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = SharedPostgres.get();

    @Autowired private MockMvc mvc;

    @Test
    void spaRoutesServeIndexWithoutCache() throws Exception {
        for (String path : new String[] {"/demo", "/login", "/registro", "/cartera/SAN.MC"}) {
            mvc.perform(get(path)).andExpect(status().isOk())
                    .andExpect(content().string(containsString("<title>Cartera</title>")))
                    .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-cache"));
        }
        // La raíz la resuelve la página de bienvenida de Spring (un forward a index.html).
        mvc.perform(get("/")).andExpect(status().isOk());
    }

    @Test
    void onlyTheDemoCanBeFramedByThePortfolio() throws Exception {
        for (String path : new String[] {"/demo", "/demo/cartera/SAN.MC"}) {
            mvc.perform(get(path)).andExpect(status().isOk())
                    .andExpect(header().string("Content-Security-Policy",
                            endsWith("frame-ancestors 'self' https://portfolio.raclos.es")))
                    .andExpect(header().doesNotExist("X-Frame-Options"));
        }
        for (String path : new String[] {"/", "/login", "/demos", "/api/health"}) {
            mvc.perform(get(path)).andExpect(status().isOk())
                    .andExpect(header().string("Content-Security-Policy", endsWith("frame-ancestors 'self'")))
                    .andExpect(header().string("X-Frame-Options", "SAMEORIGIN"));
        }
    }

    @Test
    void indexIsNeverAStale304AfterADeploy() throws Exception {
        // Los ficheros del jar llevan todos la fecha de 1980; con Last-Modified, el navegador recibía un 304 y se
        // quedaba con el index.html (y el front) del despliegue anterior.
        for (String path : new String[] {"/", "/index.html", "/demo"}) {
            mvc.perform(get(path).header(HttpHeaders.IF_MODIFIED_SINCE, "Fri, 01 Feb 1980 00:00:00 GMT"))
                    .andExpect(status().isOk())
                    .andExpect(header().doesNotExist(HttpHeaders.LAST_MODIFIED));
        }
    }

    @Test
    void hashedAssetsAreImmutable() throws Exception {
        mvc.perform(get("/assets/app-abc123.js")).andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("immutable")));
    }

    @Test
    void missingFilesAndApiAreRealNotFound() throws Exception {
        mvc.perform(get("/assets/no-existe.js")).andExpect(status().isNotFound());
        mvc.perform(get("/favicon-perdido.png")).andExpect(status().isNotFound());
        mvc.perform(get("/api/no-existe")).andExpect(status().isUnauthorized());
    }
}
