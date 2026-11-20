package com.cartera.service.auth;

import com.cartera.exception.ApiException;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import com.cartera.service.auth.GoogleCredentialVerifier.GoogleIdentity;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Entrar con Google. Una cuenta que ya existe con ese correo solo se vincula desde su propia sesión
 * ({@link #link}); la excepción es la cuenta propietaria, que en la versión anterior ya entraba con Google.
 */
@Service
@RequiredArgsConstructor
public class GoogleAuthService {

    private final GoogleCredentialVerifier verifier;
    private final UserRepository users;
    private final PasswordAuthService passwordAuth;

    @Value("${app.owner.email:}")
    private String ownerEmail;

    @Transactional
    public User login(String credential) {
        GoogleIdentity identity = verified(credential);
        var bySubject = users.findByGoogleSubject(identity.subject());
        if (bySubject.isPresent()) return bySubject.get();
        String email = PasswordAuthService.normalizeEmail(identity.email());
        var byEmail = users.findByEmail(email);
        if (byEmail.isPresent()) {
            User user = byEmail.get();
            if (user.getGoogleSubject() == null && email.equals(PasswordAuthService.normalizeEmail(ownerEmail))) {
                user.setGoogleSubject(identity.subject());
                return user;
            }
            throw ApiException.conflict("Ya existe una cuenta con ese correo. Entra con tu contraseña y vincula Google desde Ajustes.");
        }
        if (!passwordAuth.registrationEnabled()) throw ApiException.forbidden("El registro no está habilitado en este entorno.");
        return users.save(User.builder().id(UUID.randomUUID()).email(email).googleSubject(identity.subject()).build());
    }

    /** Vincula la cuenta de Google a la del usuario que tiene la sesión abierta. */
    @Transactional
    public User link(UUID userId, String credential) {
        GoogleIdentity identity = verified(credential);
        User user = users.findById(userId).orElseThrow(() -> ApiException.unauthorized("Tienes que iniciar sesión"));
        var owner = users.findByGoogleSubject(identity.subject());
        if (owner.isPresent() && !owner.get().getId().equals(userId)) {
            throw ApiException.conflict("Esa cuenta de Google ya está vinculada a otra cuenta.");
        }
        user.setGoogleSubject(identity.subject());
        return user;
    }

    private GoogleIdentity verified(String credential) {
        GoogleIdentity identity = verifier.verify(credential);
        if (!identity.emailVerified() || identity.email() == null) {
            throw ApiException.unauthorized("La cuenta de Google no tiene un correo verificado.");
        }
        return identity;
    }
}
