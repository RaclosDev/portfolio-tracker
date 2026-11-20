package com.cartera.service.auth;

import com.cartera.exception.ApiException;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;

/** Registro e inicio de sesión con correo y contraseña. */
@Service
@Slf4j
public class PasswordAuthService {

    private static final String BAD_CREDENTIALS = "Correo o contraseña incorrectos";

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final boolean registrationEnabled;
    /** Hash de coste idéntico: un correo que no existe no responde más rápido. */
    private final String dummyHash;

    public PasswordAuthService(UserRepository users, PasswordEncoder passwordEncoder,
                               @Value("${app.registration-enabled:true}") boolean registrationEnabled) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.registrationEnabled = registrationEnabled;
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        this.dummyHash = passwordEncoder.encode(HexFormat.of().formatHex(random));
    }

    public static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional
    public User login(String email, String password) {
        User user = users.findByEmail(normalizeEmail(email)).orElse(null);
        String hash = user != null && user.getPasswordHash() != null ? user.getPasswordHash() : dummyHash;
        boolean correct = passwordEncoder.matches(password, hash);
        if (user == null || user.getPasswordHash() == null || !correct) {
            throw ApiException.unauthorized(BAD_CREDENTIALS);
        }
        if (passwordEncoder.upgradeEncoding(user.getPasswordHash())) {
            user.setPasswordHash(passwordEncoder.encode(password));
            log.info("Contraseña de {} guardada de nuevo con el algoritmo actual.", user.getId());
        }
        return user;
    }

    @Transactional
    public User register(String email, String password) {
        if (!registrationEnabled) throw ApiException.forbidden("El registro no está habilitado en este entorno.");
        String normalized = normalizeEmail(email);
        if (users.findByEmail(normalized).isPresent()) {
            throw ApiException.conflict("Ya existe una cuenta con ese correo. Inicia sesión.");
        }
        try {
            return users.saveAndFlush(User.builder()
                    .id(UUID.randomUUID())
                    .email(normalized)
                    .passwordHash(passwordEncoder.encode(password))
                    .build());
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict("Ya existe una cuenta con ese correo. Inicia sesión.");
        }
    }

    public boolean registrationEnabled() {
        return registrationEnabled;
    }
}
