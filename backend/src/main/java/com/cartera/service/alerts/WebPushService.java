package com.cartera.service.alerts;

import com.cartera.dto.alerts.AlertDtos.PushDevice;
import com.cartera.dto.alerts.AlertDtos.PushKey;
import com.cartera.dto.alerts.AlertDtos.PushPayload;
import com.cartera.dto.alerts.AlertDtos.SendResult;
import com.cartera.dto.alerts.AlertDtos.Subscription;
import com.cartera.exception.ApiException;
import com.cartera.service.Quotas;
import com.cartera.model.PushSubscription;
import com.cartera.repository.PushSubscriptionRepository;
import lombok.extern.slf4j.Slf4j;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import nl.martijndwars.webpush.Urgency;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.security.GeneralSecurityException;
import java.security.Security;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Notificaciones Web Push: el navegador de cada dispositivo (móvil, tablet, PC) se suscribe y el servidor le envía
 * los avisos aunque la web esté cerrada. Sin claves VAPID configuradas no se envía nada.
 */
@Slf4j
@Service
public class WebPushService {

    private static final int TTL_SECONDS = 6 * 3600;
    /**
     * Servicios push de los navegadores (Chrome/Edge/Android, Firefox, Windows, Safari/iOS). Solo a ellos se
     * envía: con un endpoint cualquiera, el servidor haría peticiones a la dirección que eligiera el usuario (SSRF).
     */
    private static final List<String> PUSH_HOSTS = List.of("fcm.googleapis.com", "android.googleapis.com",
            ".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com");

    private final PushSubscriptionRepository subscriptions;
    private final JsonMapper json;
    private final String publicKey;
    private final PushService sender;

    public WebPushService(PushSubscriptionRepository subscriptions, JsonMapper json,
                          @Value("${app.push.vapid-public-key:}") String publicKey,
                          @Value("${app.push.vapid-private-key:}") String privateKey,
                          @Value("${app.push.vapid-subject}") String subject) throws GeneralSecurityException {
        this.subscriptions = subscriptions;
        this.json = json;
        boolean enabled = !publicKey.isBlank() && !privateKey.isBlank();
        this.publicKey = enabled ? publicKey : null;
        if (enabled && Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(new BouncyCastleProvider());
        }
        this.sender = enabled ? new PushService(publicKey, privateKey, subject) : null;
    }

    public boolean enabled() {
        return sender != null;
    }

    public PushKey key() {
        return new PushKey(publicKey, enabled());
    }

    /** Alta o actualización del dispositivo (el mismo endpoint pasa al usuario que se suscribe ahora). */
    @Transactional
    public void subscribe(UUID userId, Subscription sub, String label) {
        if (!enabled()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Las notificaciones no están configuradas en el servidor.");
        }
        if (!allowedEndpoint(sub.endpoint())) {
            throw ApiException.badRequest("endpoint: no es de un servicio de notificaciones conocido");
        }
        PushSubscription s = subscriptions.findByEndpoint(sub.endpoint()).orElseGet(PushSubscription::new);
        // Un dispositivo nuevo (o que pasa de otra cuenta a esta) cuenta; renovar uno ya registrado no.
        if (!userId.equals(s.getUserId())) {
            Quotas.check(subscriptions.countByUserId(userId) + 1, Quotas.MAX_PUSH_DEVICES, "dispositivos con avisos");
        }
        s.setUserId(userId);
        s.setEndpoint(sub.endpoint());
        s.setP256dh(sub.keys().p256dh());
        s.setAuth(sub.keys().auth());
        s.setLabel(label == null || label.isBlank() ? null : label.trim());
        subscriptions.save(s);
    }

    @Transactional
    public void unsubscribe(UUID userId, String endpoint) {
        subscriptions.deleteByEndpoint(userId, endpoint);
    }

    @Transactional
    public void remove(UUID userId, Long id) {
        if (subscriptions.deleteOwned(userId, id) == 0) throw ApiException.notFound("Dispositivo no encontrado.");
    }

    @Transactional(readOnly = true)
    public List<PushDevice> devices(UUID userId) {
        return subscriptions.findByUserIdOrderByCreatedAtAsc(userId).stream()
                .map(s -> new PushDevice(s.getId(), s.getLabel(), AlertRules.iso(s.getCreatedAt()),
                        s.getLastOkAt() == null ? null : AlertRules.iso(s.getLastOkAt()), host(s.getEndpoint())))
                .toList();
    }

    /** Envía a todos los dispositivos del usuario. Los que ya no existen (desinstalados, permiso retirado) se borran. */
    public SendResult sendAll(UUID userId, PushPayload payload) {
        if (!enabled()) return new SendResult(0, 0);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", payload.title());
        body.put("body", payload.body());
        if (payload.tag() != null) body.put("tag", payload.tag());
        if (payload.url() != null) body.put("url", payload.url());
        // El service worker solo la enseña si el dispositivo sigue con la sesión de este usuario.
        body.put("accountId", userId.toString());
        String text = json.writeValueAsString(body);
        int sent = 0;
        int failed = 0;
        for (PushSubscription s : subscriptions.findByUserIdOrderByCreatedAtAsc(userId)) {
            if (!allowedEndpoint(s.getEndpoint())) {
                failed++;
                continue;
            }
            try {
                Notification n = Notification.builder().endpoint(s.getEndpoint()).userPublicKey(s.getP256dh())
                        .userAuth(s.getAuth()).payload(text).ttl(TTL_SECONDS).urgency(Urgency.HIGH).build();
                int code = sender.send(n).getStatusLine().getStatusCode();
                if (code >= 200 && code < 300) {
                    sent++;
                    subscriptions.markOk(s.getId(), Instant.now());
                    continue;
                }
                failed++;
                if (code == 404 || code == 410) subscriptions.deleteById(s.getId());
                else log.warn("No se pudo enviar una notificación a {}: HTTP {}", host(s.getEndpoint()), code);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                failed++;
                break;
            } catch (Exception e) {
                failed++;
                log.warn("No se pudo enviar una notificación a {}: {}", host(s.getEndpoint()), e.toString());
            }
        }
        return new SendResult(sent, failed);
    }

    static boolean allowedEndpoint(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            String h = uri.getHost();
            if (!"https".equals(uri.getScheme()) || h == null || uri.getPort() != -1 || uri.getUserInfo() != null) {
                return false;
            }
            String host = h.toLowerCase(java.util.Locale.ROOT);
            return PUSH_HOSTS.stream().anyMatch(a -> a.startsWith(".") ? host.endsWith(a) : host.equals(a));
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static String host(String endpoint) {
        try {
            String h = URI.create(endpoint).getHost();
            return h == null ? "" : h;
        } catch (IllegalArgumentException e) {
            return "";
        }
    }
}
