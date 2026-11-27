package com.cartera;

import com.cartera.repository.RefreshTokenRepository;
import com.cartera.repository.UserRepository;
import com.cartera.service.market.composition.IsinLookup;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Cuenta propia: bloqueo de inicio de sesión, cambio de contraseña, cierre de todas las sesiones y borrado. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.jwt.secret=integration-test-secret-0123456789-abcdefghijklmnop",
        "app.owner.email=",
        "app.rate-limiting.enabled=false",
        "app.alerts.scheduler-enabled=false"})
@Testcontainers(disabledWithoutDocker = true)
class AccountIntegrationTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final String COOKIE = "__Secure-cartera_refresh";
    private static final String PASSWORD = "una-contraseña-de-prueba-larga";
    private static final String NEW_PASSWORD = "otra-contraseña-distinta-larga";

    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = SharedPostgres.get();

    @MockitoBean private IsinLookup isins;

    @Autowired private MockMvc mvc;
    @Autowired private JsonMapper json;
    @Autowired private UserRepository users;
    @Autowired private RefreshTokenRepository tokens;

    /** Quien falla 10 veces queda frenado en su IP, pero el dueño de la cuenta entra desde la suya. */
    @Test
    void failuresBlockOnlyTheSameIpAndEmail() throws Exception {
        String email = email("bloqueo");
        register(email);
        for (int i = 0; i < 10; i++) {
            mvc.perform(login(email, "mal-" + i, "10.0.0.9")).andExpect(status().isUnauthorized());
        }
        // Esa IP queda frenada incluso con la contraseña correcta...
        mvc.perform(login(email, PASSWORD, "10.0.0.9")).andExpect(status().isTooManyRequests());
        // ... pero el dueño, desde otra IP, entra.
        mvc.perform(login(email, PASSWORD, "10.0.0.10")).andExpect(status().isOk());
    }

    @Test
    void changePasswordClosesOtherSessions() throws Exception {
        String email = email("cambio");
        MockHttpServletResponse reg = register(email);
        String token = access(reg);
        String oldRefresh = reg.getCookie(COOKIE).getValue();
        // Segundo dispositivo.
        String otherRefresh = mvc.perform(login(email, PASSWORD, null)).andExpect(status().isOk())
                .andReturn().getResponse().getCookie(COOKIE).getValue();

        mvc.perform(auth(post("/api/users/me/password"), token).contentType(MediaType.APPLICATION_JSON)
                        .content(passwordBody("no-es-esta", NEW_PASSWORD))).andExpect(status().isUnauthorized());
        mvc.perform(auth(post("/api/users/me/password"), token).contentType(MediaType.APPLICATION_JSON)
                        .content(passwordBody(PASSWORD, "corta"))).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/users/me/password"), token).contentType(MediaType.APPLICATION_JSON)
                        .content(passwordBody(PASSWORD, PASSWORD))).andExpect(status().isBadRequest());

        MockHttpServletResponse changed = mvc.perform(auth(post("/api/users/me/password"), token)
                        .contentType(MediaType.APPLICATION_JSON).content(passwordBody(PASSWORD, NEW_PASSWORD)))
                .andExpect(status().isOk()).andReturn().getResponse();
        String newRefresh = changed.getCookie(COOKIE).getValue();

        mvc.perform(refresh(oldRefresh)).andExpect(status().isUnauthorized());
        mvc.perform(refresh(otherRefresh)).andExpect(status().isUnauthorized());
        mvc.perform(refresh(newRefresh)).andExpect(status().isOk());
        mvc.perform(login(email, PASSWORD, null)).andExpect(status().isUnauthorized());
        mvc.perform(login(email, NEW_PASSWORD, null)).andExpect(status().isOk());
    }

    @Test
    void closeAllSessionsRevokesEveryRefreshToken() throws Exception {
        String email = email("sesiones");
        MockHttpServletResponse reg = register(email);
        String a = reg.getCookie(COOKIE).getValue();
        String b = mvc.perform(login(email, PASSWORD, null)).andReturn().getResponse().getCookie(COOKIE).getValue();

        mvc.perform(delete("/api/users/me/sessions").header(HttpHeaders.ORIGIN, ORIGIN)).andExpect(status().isUnauthorized());
        mvc.perform(auth(delete("/api/users/me/sessions"), access(reg))).andExpect(status().isNoContent());

        mvc.perform(refresh(a)).andExpect(status().isUnauthorized());
        mvc.perform(refresh(b)).andExpect(status().isUnauthorized());
    }

    @Test
    void deleteAccountRemovesTheUserAndHisData() throws Exception {
        String email = email("borrar");
        MockHttpServletResponse reg = register(email);
        String token = access(reg);
        UUID id = UUID.fromString(json.readTree(reg.getContentAsString()).get("user").get("id").asString());
        mvc.perform(auth(post("/api/lists"), token).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Mi lista\"}"))
                .andExpect(status().isCreated());

        mvc.perform(auth(post("/api/users/me/delete"), token).contentType(MediaType.APPLICATION_JSON)
                .content("{}")).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/users/me/delete"), token).contentType(MediaType.APPLICATION_JSON)
                .content("{\"password\":\"no-es-esta\"}")).andExpect(status().isUnauthorized());
        assertThat(users.existsById(id)).isTrue();

        mvc.perform(auth(post("/api/users/me/delete"), token).contentType(MediaType.APPLICATION_JSON)
                .content("{\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isNoContent());

        assertThat(users.existsById(id)).isFalse();
        assertThat(tokens.count()).isGreaterThanOrEqualTo(0);
        mvc.perform(auth(get("/api/lists"), token)).andExpect(status().isUnauthorized());
        mvc.perform(login(email, PASSWORD, null)).andExpect(status().isUnauthorized());
    }

    // --- ayudas ---

    private static String email(String prefix) {
        return prefix + "-" + UUID.randomUUID() + "@test.invalid";
    }

    private MockHttpServletResponse register(String email) throws Exception {
        return mvc.perform(post("/api/auth/password/register").header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse();
    }

    private String access(MockHttpServletResponse res) throws Exception {
        JsonNode body = json.readTree(res.getContentAsString());
        return body.get("accessToken").asString();
    }

    private static String passwordBody(String current, String next) {
        return "{\"currentPassword\":\"" + current + "\",\"newPassword\":\"" + next + "\"}";
    }

    private static MockHttpServletRequestBuilder login(String email, String password, String ip) {
        MockHttpServletRequestBuilder req = post("/api/auth/password/login").header(HttpHeaders.ORIGIN, ORIGIN)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}");
        return ip == null ? req : req.header("X-Forwarded-For", ip);
    }

    private static MockHttpServletRequestBuilder refresh(String refreshToken) {
        return post("/api/auth/session/refresh").header(HttpHeaders.ORIGIN, ORIGIN).cookie(new Cookie(COOKIE, refreshToken));
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder req, String token) {
        return req.header(HttpHeaders.AUTHORIZATION, "Bearer " + token).header(HttpHeaders.ORIGIN, ORIGIN);
    }
}
