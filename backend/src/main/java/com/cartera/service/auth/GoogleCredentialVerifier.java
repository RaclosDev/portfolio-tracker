package com.cartera.service.auth;

import com.cartera.exception.ApiException;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.List;

/** Verifica el ID token de Google Identity Services (firma, emisor, audiencia y caducidad). */
@Component
@Slf4j
public class GoogleCredentialVerifier {

    private final String clientId;
    private final GoogleIdTokenVerifier verifier;

    public GoogleCredentialVerifier(@Value("${google.client.id:}") String clientId) {
        this.clientId = clientId == null ? "" : clientId.trim();
        this.verifier = new GoogleIdTokenVerifier.Builder(new NetHttpTransport(), new GsonFactory())
                .setAudience(List.of(this.clientId))
                .build();
    }

    public boolean enabled() {
        return !clientId.isEmpty();
    }

    public String clientId() {
        return clientId;
    }

    /** Datos de la cuenta de Google, o 401 si el token no es válido. */
    public GoogleIdentity verify(String credential) {
        if (!enabled()) throw ApiException.forbidden("El acceso con Google no está configurado.");
        GoogleIdToken idToken;
        try {
            idToken = verifier.verify(credential);
        } catch (GeneralSecurityException | IOException | IllegalArgumentException e) {
            log.warn("No se pudo verificar el token de Google: {}", e.getMessage());
            idToken = null;
        }
        if (idToken == null) throw ApiException.unauthorized("No se pudo verificar la cuenta de Google.");
        GoogleIdToken.Payload payload = idToken.getPayload();
        return new GoogleIdentity(payload.getSubject(), payload.getEmail(), Boolean.TRUE.equals(payload.getEmailVerified()));
    }

    public record GoogleIdentity(String subject, String email, boolean emailVerified) {
    }
}
