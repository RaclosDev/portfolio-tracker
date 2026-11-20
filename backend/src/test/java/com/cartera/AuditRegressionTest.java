package com.cartera;

import com.cartera.exception.GlobalExceptionHandler;
import com.cartera.repository.MarketCacheRepository;
import com.cartera.repository.OperationRepository;
import com.cartera.service.market.composition.IsinLookup;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Fallos encontrados en la auditoría del backend: cada test reproduce uno. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.jwt.secret=integration-test-secret-0123456789-abcdefghijklmnop",
        "app.owner.email=",
        "app.rate-limiting.enabled=false",
        "app.alerts.scheduler-enabled=false"})
@Testcontainers(disabledWithoutDocker = true)
class AuditRegressionTest {

    private static final String ORIGIN = "http://localhost:5173";

    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = SharedPostgres.get();

    @MockitoBean private IsinLookup isins;

    @Autowired private MockMvc mvc;
    @Autowired private MarketCacheRepository cache;
    @Autowired private PlatformTransactionManager txManager;
    @Autowired private OperationRepository operations;
    @Autowired private JsonMapper json;

    /** La caché de mercado se guarda aunque quien llama esté en una transacción de solo lectura. */
    @Test
    void marketCacheSavesInsideReadOnlyTransaction() {
        String symbol = "RO-" + UUID.randomUUID();
        TransactionTemplate ro = new TransactionTemplate(txManager);
        ro.setReadOnly(true);
        ro.executeWithoutResult(s -> {
            cache.save("quote", symbol, Map.of("price", 1.5));
            // Tras el intento de escritura, la lectura en la misma transacción tiene que seguir funcionando.
            cache.find("quote", "otro");
        });
        assertThat(cache.find("quote", symbol)).isNotNull();
    }

    /** BCrypt no admite más de 72 bytes: no puede acabar en 500. */
    @Test
    void longPasswordsAreRejectedCleanly() throws Exception {
        String email = "larga-" + UUID.randomUUID() + "@test.invalid";
        String longPassword = "ñ".repeat(60); // 60 caracteres, 120 bytes
        mvc.perform(post("/api/auth/password/register").header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + longPassword + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/password/login").header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + "x".repeat(150) + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    /** Tras 10 fallos con el mismo correo se bloquea el correo, aunque cada intento venga de una IP distinta. */
    @Test
    void loginIsLimitedPerEmail() throws Exception {
        String email = "bloqueo-" + UUID.randomUUID() + "@test.invalid";
        register(email);
        for (int i = 0; i < 10; i++) {
            mvc.perform(login(email, "mal-" + i).header("X-Forwarded-For", "10.0.0." + i))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(login(email, PASSWORD)).andExpect(status().isTooManyRequests());
    }

    /** Restaurar no busca ISIN con la transacción abierta: lo completa después, fuera de ella. */
    @Test
    void restoreLooksUpIsinsAfterCommit() throws Exception {
        String token = register("restaurar-" + UUID.randomUUID() + "@test.invalid");
        AtomicBoolean insideTx = new AtomicBoolean();
        when(isins.isinOf(anyString())).thenAnswer(inv -> {
            if (TransactionSynchronizationManager.isActualTransactionActive()) insideTx.set(true);
            return "ES0113900J37";
        });
        mvc.perform(auth(post("/api/backup"), token).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":1,\"lists\":[{\"name\":\"Bancos\",\"items\":[{\"symbol\":\"SANREST.MC\"}]}]}"))
                .andExpect(status().isOk());
        verify(isins, timeout(5_000)).isinOf("SANREST.MC");
        assertThat(insideTx).isFalse();
        String backup = "";
        for (int i = 0; i < 50 && !backup.contains("ES0113900J37"); i++) {
            Thread.sleep(100);
            backup = mvc.perform(auth(get("/api/backup"), token)).andReturn().getResponse().getContentAsString();
        }
        assertThat(backup).contains("ES0113900J37");
    }

    /** Un cuerpo JSON enorme se rechaza antes de leerlo. */
    @Test
    void hugeBodiesAreRejected() throws Exception {
        String token = register("grande-" + UUID.randomUUID() + "@test.invalid");
        byte[] huge = new byte[13 * 1024 * 1024];
        java.util.Arrays.fill(huge, (byte) ' ');
        mvc.perform(auth(post("/api/backup"), token).contentType(MediaType.APPLICATION_JSON).content(huge))
                .andExpect(status().isPayloadTooLarge());
    }

    /** La comprobación de divisa ya no carga todas las operaciones: la consulta tiene que funcionar con y sin id. */
    @Test
    void existsPricedQueryRuns() {
        UUID nobody = UUID.randomUUID();
        assertThat(operations.existsPriced(nobody, "SAN", null)).isFalse();
        assertThat(operations.existsPriced(nobody, "SAN", 42L)).isFalse();
    }

    /** Dos peticiones a la vez que chocan en una restricción única dan 409, no 500. */
    @Test
    void integrityViolationsAreConflicts() {
        assertThat(new GlobalExceptionHandler().conflict(new DataIntegrityViolationException("duplicada"))
                .getStatusCode().value()).isEqualTo(409);
    }

    private static final String PASSWORD = "una-contraseña-de-prueba-larga";

    private String register(String email) throws Exception {
        String res = mvc.perform(post("/api/auth/password/register").header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return json.readTree(res).get("accessToken").asString();
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder login(String email,
                                                                                                  String password) {
        return post("/api/auth/password/login").header(HttpHeaders.ORIGIN, ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}");
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder auth(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder req, String token) {
        return req.header(HttpHeaders.AUTHORIZATION, "Bearer " + token).header(HttpHeaders.ORIGIN, ORIGIN);
    }
}
