package com.cartera;

import com.cartera.repository.UserRepository;
import com.cartera.service.alerts.AlertWorkset;
import com.cartera.service.market.composition.IsinLookup;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** La API de punta a punta con Postgres real: cuentas, listas, valores, ajustes e importación de la cartera. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.jwt.secret=integration-test-secret-0123456789-abcdefghijklmnop",
        "app.owner.email=",
        "app.rate-limiting.enabled=false",
        "app.alerts.scheduler-enabled=false"})
@Testcontainers(disabledWithoutDocker = true)
class ApiIntegrationTest {

    private static final String ORIGIN = "http://localhost:5173";

    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = SharedPostgres.get();

    /** Sin red: el ISIN automático preguntaría a Yahoo y Financial Hub. */
    @MockitoBean private IsinLookup isins;

    @Autowired private MockMvc mvc;
    @Autowired private JsonMapper json;
    @Autowired private UserRepository users;
    @Autowired private AlertWorkset workset;

    @Test
    void healthAndConfigArePublic() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
        mvc.perform(get("/api/auth/config")).andExpect(status().isOk()).andExpect(jsonPath("$.registrationEnabled").value(true));
        mvc.perform(get("/actuator/health/liveness")).andExpect(status().isOk());
    }

    @Test
    void apiNeedsASession() throws Exception {
        mvc.perform(get("/api/lists")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/lists").header(HttpHeaders.AUTHORIZATION, "Bearer no-es-un-token")).andExpect(status().isUnauthorized());
    }

    @Test
    void registerLoginAndProfile() throws Exception {
        String email = "alta-" + UUID.randomUUID() + "@test.invalid";
        mvc.perform(post("/api/auth/password/register").header(HttpHeaders.ORIGIN, ORIGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"corta\"}"))
                .andExpect(status().isBadRequest());
        String token = register(email);
        mvc.perform(post("/api/auth/password/login").header(HttpHeaders.ORIGIN, ORIGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"otra-contraseña-mala\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/password/login").header(HttpHeaders.ORIGIN, ORIGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.accessToken").isString());
        mvc.perform(auth(get("/api/users/me"), token)).andExpect(status().isOk()).andExpect(jsonPath("$.email").value(email));
    }

    @Test
    void listsAndItemsBelongToTheirOwner() throws Exception {
        when(isins.isinOf(anyString())).thenReturn("ES0113900J37");
        String ana = register("ana-" + UUID.randomUUID() + "@test.invalid");
        String luis = register("luis-" + UUID.randomUUID() + "@test.invalid");

        JsonNode list = body(mvc.perform(auth(post("/api/lists"), ana).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Bancos\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        long listId = list.get("id").asLong();

        JsonNode item = body(mvc.perform(auth(post("/api/items"), ana).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"listId\":" + listId + ",\"symbol\":\"san.mc\",\"buyPrices\":[4.5,4]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        assertThat(item.get("symbol").asString()).isEqualTo("SAN.MC");
        assertThat(item.get("isin").asString()).isEqualTo("ES0113900J37");
        long itemId = item.get("id").asLong();

        mvc.perform(auth(patch("/api/items/" + itemId), luis).contentType(MediaType.APPLICATION_JSON).content("{\"notes\":\"mío\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/lists"), luis)).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.id == " + listId + ")]").isEmpty());

        mvc.perform(auth(patch("/api/items/" + itemId), ana).contentType(MediaType.APPLICATION_JSON).content("{\"notes\":\"vigilar\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.notes").value("vigilar"));
        mvc.perform(auth(delete("/api/items/" + itemId), luis)).andExpect(status().isNotFound());
        mvc.perform(auth(delete("/api/items/" + itemId), ana)).andExpect(status().isNoContent());
    }

    @Test
    void bootstrapBringsTheFirstScreenInOneRequest() throws Exception {
        String ana = register("boot-" + UUID.randomUUID() + "@test.invalid");
        String luis = register("boot-" + UUID.randomUUID() + "@test.invalid");
        long mine = body(mvc.perform(auth(post("/api/lists"), ana).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Bancos\"}")).andReturn().getResponse().getContentAsString()).get("id").asLong();

        mvc.perform(auth(get("/api/bootstrap").param("list", String.valueOf(mine)).param("page", "lista"), ana))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listId").value(mine))
                .andExpect(jsonPath("$.settings").exists())
                .andExpect(jsonPath("$.lists[?(@.id == " + mine + ")]").exists())
                .andExpect(jsonPath("$.watchlist").exists())
                .andExpect(jsonPath("$.portfolio").exists())
                .andExpect(jsonPath("$.visited").isArray())
                .andExpect(jsonPath("$.touchedOrders").isArray());
        mvc.perform(auth(get("/api/bootstrap").param("list", "-1"), ana))
                .andExpect(status().isOk()).andExpect(jsonPath("$.listId").value(-1));
        // Una lista ajena no se abre: se cae a la primera propia.
        mvc.perform(auth(get("/api/bootstrap").param("list", String.valueOf(mine)), luis))
                .andExpect(status().isOk()).andExpect(jsonPath("$.listId").value(org.hamcrest.Matchers.not(mine)));
        mvc.perform(auth(get("/api/bootstrap").param("page", "otra"), ana)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/bootstrap")).andExpect(status().isUnauthorized());
    }

    @Test
    void settingsArePatchedPartially() throws Exception {
        String token = register("ajustes-" + UUID.randomUUID() + "@test.invalid");
        mvc.perform(auth(patch("/api/settings"), token).contentType(MediaType.APPLICATION_JSON).content("{\"baseCurrency\":\"USD\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.baseCurrency").value("USD"));
        mvc.perform(auth(get("/api/settings"), token)).andExpect(status().isOk()).andExpect(jsonPath("$.baseCurrency").value("USD"));
        mvc.perform(auth(patch("/api/settings"), token).contentType(MediaType.APPLICATION_JSON).content("{\"baseCurrency\":\"dólares\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void importSkipsDuplicatesUnlessAsked() throws Exception {
        String token = register("cartera-" + UUID.randomUUID() + "@test.invalid");
        String req = """
                {"instruments":[{"ticker":"SAN","symbol":"SAN.MC","currency":"EUR"}],
                 "operations":[{"date":"2026-01-05","ticker":"SAN","type":"buy","shares":100,"price":5,"amountEur":500}]}""";
        mvc.perform(auth(post("/api/portfolio/import"), token).contentType(MediaType.APPLICATION_JSON).content(req))
                .andExpect(status().isOk()).andExpect(jsonPath("$.imported").value(1));
        mvc.perform(auth(post("/api/portfolio/import"), token).contentType(MediaType.APPLICATION_JSON).content(req))
                .andExpect(status().isOk()).andExpect(jsonPath("$.imported").value(0)).andExpect(jsonPath("$.skipped").value(1));
        mvc.perform(auth(post("/api/portfolio/import"), token).contentType(MediaType.APPLICATION_JSON)
                        .content(req.replace("\"amountEur\":500", "\"amountEur\":-500")))
                .andExpect(status().isBadRequest());
        mvc.perform(auth(get("/api/portfolio/history"), token).param("from", "2026-02-30").param("to", "2026-03-01"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void watcherKeepsUserDataInMemoryUntilTheUserChangesSomething() throws Exception {
        when(isins.isinOf(anyString())).thenReturn("ES0113900J37");
        String email = "vigilante-" + UUID.randomUUID() + "@test.invalid";
        String token = register(email);
        UUID userId = users.findByEmail(email).orElseThrow().getId();
        assertThat(workset.users()).contains(userId);

        JsonNode list = body(mvc.perform(auth(post("/api/lists"), token).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Vigilar\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        long itemId = body(mvc.perform(auth(post("/api/items"), token).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"listId\":" + list.get("id").asLong() + ",\"symbol\":\"san.mc\",\"buyPrices\":[4.5]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();

        AlertWorkset.UserData first = workset.get(userId);
        assertThat(first.lists()).filteredOn(l -> l.list().name().equals("Vigilar")).singleElement()
                .satisfies(l -> assertThat(l.items()).hasSize(1));
        // Sin cambios, la siguiente vuelta usa lo que ya tiene en memoria (no vuelve a leer la base de datos).
        mvc.perform(auth(get("/api/lists"), token)).andExpect(status().isOk());
        assertThat(workset.get(userId)).isSameAs(first);

        // Un cambio por la API lo invalida y la siguiente vuelta ya ve la orden nueva.
        mvc.perform(auth(patch("/api/items/" + itemId), token).contentType(MediaType.APPLICATION_JSON)
                .content("{\"orderPrice\":4.2,\"orderActive\":true}")).andExpect(status().isOk());
        AlertWorkset.UserData second = workset.get(userId);
        assertThat(second).isNotSameAs(first);
        assertThat(second.lists()).flatMap(AlertWorkset.ListData::items).singleElement()
                .satisfies(i -> assertThat(i.orderPrice()).isEqualTo(4.2));
    }

    private static final String PASSWORD = "una-contraseña-de-prueba-larga";

    private String register(String email) throws Exception {
        String res = mvc.perform(post("/api/auth/password/register").header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isCreated()).andExpect(cookie().exists(refreshCookie()))
                .andReturn().getResponse().getContentAsString();
        return body(res).get("accessToken").asString();
    }

    private static String refreshCookie() {
        return "__Secure-cartera_refresh";
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder req, String token) {
        return req.header(HttpHeaders.AUTHORIZATION, "Bearer " + token).header(HttpHeaders.ORIGIN, ORIGIN);
    }

    private JsonNode body(String s) {
        return json.readTree(s);
    }
}
