package com.cartera;

import com.cartera.model.Snapshot;
import com.cartera.repository.SnapshotRepository;
import com.cartera.repository.UserRepository;
import com.cartera.service.market.composition.IsinLookup;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Topes por cuenta: pasarlos da un 422 claro y no deja datos a medias. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.jwt.secret=integration-test-secret-0123456789-abcdefghijklmnop",
        "app.owner.email=",
        "app.rate-limiting.enabled=false",
        "app.alerts.scheduler-enabled=false"})
@Testcontainers(disabledWithoutDocker = true)
class QuotasIntegrationTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final String PASSWORD = "una-contraseña-de-prueba-larga";

    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = SharedPostgres.get();

    /** Claves VAPID de verdad (P-256) para que las notificaciones estén activas y se pueda probar el tope de dispositivos. */
    @DynamicPropertySource
    static void vapid(DynamicPropertyRegistry registry) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair pair = generator.generateKeyPair();
        ECPublicKey pub = (ECPublicKey) pair.getPublic();
        byte[] point = new byte[65];
        point[0] = 4;
        System.arraycopy(fixed(pub.getW().getAffineX()), 0, point, 1, 32);
        System.arraycopy(fixed(pub.getW().getAffineY()), 0, point, 33, 32);
        byte[] secret = fixed(((ECPrivateKey) pair.getPrivate()).getS());
        Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
        registry.add("app.push.vapid-public-key", () -> b64.encodeToString(point));
        registry.add("app.push.vapid-private-key", () -> b64.encodeToString(secret));
    }

    private static byte[] fixed(BigInteger n) {
        byte[] raw = n.toByteArray();
        byte[] out = new byte[32];
        int len = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - len, out, 32 - len, len);
        return out;
    }

    @MockitoBean private IsinLookup isins;

    @Autowired private MockMvc mvc;
    @Autowired private JsonMapper json;
    @Autowired private UserRepository users;
    @Autowired private SnapshotRepository snapshots;

    @Test
    void listsAreCappedPerAccount() throws Exception {
        String token = register();
        // Ya existe «Vigilar nuevas»: caben 49 más.
        for (int i = 1; i < 50; i++) {
            mvc.perform(auth(post("/api/lists"), token).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"Lista " + i + "\"}")).andExpect(status().isCreated());
        }
        MockHttpServletResponse res = mvc.perform(auth(post("/api/lists"), token).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Una de más\"}")).andExpect(status().isUnprocessableContent())
                .andReturn().getResponse();
        assertThat(res.getContentAsString()).contains("límite de listas");
    }

    @Test
    void aBackupBiggerThanTheQuotasIsRejectedBeforeTouchingAnything() throws Exception {
        String token = register();
        StringBuilder items = new StringBuilder();
        for (int i = 0; i < 2_001; i++) {
            if (i > 0) items.append(',');
            items.append("{\"symbol\":\"S").append(i).append("\"}");
        }
        String body = "{\"version\":1,\"lists\":[{\"name\":\"Enorme\",\"items\":[" + items + "]}]}";
        MockHttpServletResponse res = mvc.perform(auth(post("/api/backup"), token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnprocessableContent()).andReturn().getResponse();
        assertThat(res.getContentAsString()).contains("valores vigilados");
        // Sigue todo como estaba y no se ha guardado ninguna copia previa.
        JsonNode lists = json.readTree(mvc.perform(auth(get("/api/lists"), token)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(lists).hasSize(1);
        assertThat(json.readTree(mvc.perform(auth(get("/api/snapshots"), token)).andReturn().getResponse()
                .getContentAsString())).isEmpty();
    }

    @Test
    void devicesWithAlertsAreCappedButAnExistingOneCanRenew() throws Exception {
        String token = register();
        for (int i = 0; i < 10; i++) subscribe(token, i).andExpectCreated();
        MockHttpServletResponse res = mvc.perform(subscribeRequest(token, 10))
                .andExpect(status().isUnprocessableContent()).andReturn().getResponse();
        assertThat(res.getContentAsString()).contains("dispositivos");
        // Renovar un dispositivo ya registrado no cuenta como uno nuevo.
        subscribe(token, 3).andExpectCreated();
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void savedCopiesAreTrimmedBySizeKeepingTheNewest() throws Exception {
        String email = "copias-" + UUID.randomUUID() + "@test.invalid";
        register(email);
        UUID id = users.findByEmail(email).orElseThrow().getId();
        String data = "{\"version\":1,\"lists\":[],\"padding\":\"" + "x".repeat(500) + "\"}";
        for (int i = 0; i < 4; i++) snapshots.saveAndFlush(new Snapshot(id, "prueba " + i, data));
        assertThat(snapshots.summaries(id)).hasSize(4);

        // Con un presupuesto de poco más de una copia solo se queda la más reciente.
        snapshots.pruneBySize(id, 700);
        assertThat(snapshots.summaries(id)).hasSize(1);
        assertThat(snapshots.summaries(id).getFirst().getReason()).isEqualTo("prueba 3");
    }

    // --- ayudas ---

    /** Resultado de suscribir un dispositivo: permite esperar el 201 en una línea. */
    private record Subscribed(org.springframework.test.web.servlet.ResultActions actions) {
        void andExpectCreated() throws Exception {
            actions.andExpect(status().isCreated());
        }
    }

    private Subscribed subscribe(String token, int n) throws Exception {
        return new Subscribed(mvc.perform(subscribeRequest(token, n)));
    }

    private static MockHttpServletRequestBuilder subscribeRequestBase(String token) {
        return auth(post("/api/push/subscribe"), token).contentType(MediaType.APPLICATION_JSON);
    }

    private MockHttpServletRequestBuilder subscribeRequest(String token, int n) {
        String body = "{\"subscription\":{\"endpoint\":\"https://fcm.googleapis.com/fcm/send/dispositivo-" + n
                + "-" + token.hashCode() + "\",\"keys\":{\"p256dh\":\"clave-" + n + "\",\"auth\":\"auth-" + n
                + "\"}},\"label\":\"Móvil " + n + "\"}";
        return subscribeRequestBase(token).content(body);
    }

    private String register() throws Exception {
        return register("tope-" + UUID.randomUUID() + "@test.invalid");
    }

    private String register(String email) throws Exception {
        MockHttpServletResponse res = mvc.perform(post("/api/auth/password/register").header(HttpHeaders.ORIGIN, ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse();
        return json.readTree(res.getContentAsString()).get("accessToken").asString();
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder req, String token) {
        return req.header(HttpHeaders.AUTHORIZATION, "Bearer " + token).header(HttpHeaders.ORIGIN, ORIGIN);
    }
}
