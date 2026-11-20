package com.cartera.service.auth;

import com.cartera.exception.ApiException;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import com.cartera.event.UserCreatedEvent;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/** Registro e inicio de sesión con correo y contraseña. */
@Service
@Slf4j
public class PasswordAuthService {

    private static final String BAD_CREDENTIALS = "Correo o contraseña incorrectos";
    /** bcrypt solo usa los primeros 72 bytes y Spring Security rechaza (con una excepción) las más largas. */
    static final int MAX_PASSWORD_BYTES = 72;
    /** Fallos seguidos por correo antes de frenar: el límite por IP no basta si el atacante cambia de IP. */
    static final int MAX_FAILURES_PER_EMAIL = 10;
    private final Cache<String, AtomicInteger> failures =
            Caffeine.newBuilder().expireAfterWrite(Duration.ofMinutes(15))
                    .maximumSize(10_000).build();

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final ApplicationEventPublisher events;
    private final boolean registrationEnabled;
    /** Hash de coste idéntico: un correo que no existe no responde más rápido. */
    private final String dummyHash;

    public PasswordAuthService(UserRepository users, PasswordEncoder passwordEncoder, ApplicationEventPublisher events,
                               @Value("${app.registration-enabled:true}") boolean registrationEnabled) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.events = events;
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
        String normalized = normalizeEmail(email);
        AtomicInteger failed = failures.getIfPresent(normalized);
        if (failed != null && failed.get() >= MAX_FAILURES_PER_EMAIL) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "Demasiados intentos con este correo. Espera unos minutos y vuelve a probar.");
        }
        User user = users.findByEmail(normalized).orElse(null);
        String hash = user != null && user.getPasswordHash() != null ? user.getPasswordHash() : dummyHash;
        boolean tooLong = tooLong(password);
        // Una contraseña larga solo puede valer con un hash scrypt antiguo (sin prefijo): bcrypt no la admite.
        boolean legacy = !hash.startsWith("{");
        boolean correct;
        if (tooLong && !legacy) {
            passwordEncoder.matches("x", dummyHash); // mismo coste que una comprobación normal
            correct = false;
        } else {
            correct = passwordEncoder.matches(password, hash);
        }
        if (user == null || user.getPasswordHash() == null || !correct) {
            failures.get(normalized, k -> new AtomicInteger()).incrementAndGet();
            throw ApiException.unauthorized(BAD_CREDENTIALS);
        }
        failures.invalidate(normalized);
        if (!tooLong && passwordEncoder.upgradeEncoding(user.getPasswordHash())) {
            user.setPasswordHash(passwordEncoder.encode(password));
            log.info("Contraseña de {} guardada de nuevo con el algoritmo actual.", user.getId());
        }
        return user;
    }

    @Transactional
    public User register(String email, String password) {
        if (!registrationEnabled) throw ApiException.forbidden("El registro no está habilitado en este entorno.");
        if (tooLong(password)) {
            throw ApiException.badRequest("La contraseña es demasiado larga: como mucho 72 caracteres (menos si lleva tildes o emojis).");
        }
        String normalized = normalizeEmail(email);
        if (users.findByEmail(normalized).isPresent()) {
            throw ApiException.conflict("Ya existe una cuenta con ese correo. Inicia sesión.");
        }
        try {
            User user = users.saveAndFlush(User.builder()
                    .id(UUID.randomUUID())
                    .email(normalized)
                    .passwordHash(passwordEncoder.encode(password))
                    .build());
            events.publishEvent(new UserCreatedEvent(user.getId()));
            return user;
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict("Ya existe una cuenta con ese correo. Inicia sesión.");
        }
    }

    private static boolean tooLong(String password) {
        return password.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES;
    }

    public boolean registrationEnabled() {
        return registrationEnabled;
    }
}
