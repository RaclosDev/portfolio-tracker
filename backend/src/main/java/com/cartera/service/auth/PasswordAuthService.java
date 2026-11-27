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
    static final int MIN_PASSWORD_CHARS = 12;
    /**
     * Fallos seguidos desde una misma IP contra un mismo correo antes de frenar esa IP con ese correo. Así quien
     * escribe mal la contraseña no deja fuera al dueño de la cuenta, que entra desde otra IP.
     */
    static final int MAX_FAILURES_PER_EMAIL_AND_IP = 10;
    /**
     * Techo por correo sumando todas las IP (un ataque repartido). Es alto a propósito: al llegar a él se bloquea
     * hasta la contraseña correcta, para que nadie pueda seguir probando sin límite.
     */
    static final int MAX_FAILURES_PER_EMAIL = 100;
    private final Cache<String, AtomicInteger> failures = failureWindow();
    private final Cache<String, AtomicInteger> failuresByIp = failureWindow();

    private static Cache<String, AtomicInteger> failureWindow() {
        return Caffeine.newBuilder().expireAfterWrite(Duration.ofMinutes(15)).maximumSize(10_000).build();
    }

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

    /** Entra con correo y contraseña. {@code ip}: de quién viene el intento, para contar los fallos por IP. */
    @Transactional
    public User login(String email, String password, String ip) {
        String normalized = normalizeEmail(email);
        User user = users.findByEmail(normalized).orElse(null);
        verify(user, normalized, password, ip);
        if (!tooLong(password) && passwordEncoder.upgradeEncoding(user.getPasswordHash())) {
            user.setPasswordHash(passwordEncoder.encode(password));
            log.info("Contraseña de {} guardada de nuevo con el algoritmo actual.", user.getId());
        }
        return user;
    }

    /**
     * Comprueba la contraseña de quien ya tiene sesión (cambiar la contraseña, borrar la cuenta). Cuenta los
     * fallos igual que el inicio de sesión: un token robado no sirve para adivinar la contraseña a ciegas.
     */
    public void confirmPassword(User user, String password, String ip) {
        verify(user, normalizeEmail(user.getEmail()), password, ip);
    }

    private void verify(User user, String normalized, String password, String ip) {
        String ipKey = ip + "|" + normalized;
        AtomicInteger byIp = failuresByIp.getIfPresent(ipKey);
        AtomicInteger byEmail = failures.getIfPresent(normalized);
        if ((byIp != null && byIp.get() >= MAX_FAILURES_PER_EMAIL_AND_IP)
                || (byEmail != null && byEmail.get() >= MAX_FAILURES_PER_EMAIL)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "Demasiados intentos con este correo. Espera unos minutos y vuelve a probar.");
        }
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
            failuresByIp.get(ipKey, k -> new AtomicInteger()).incrementAndGet();
            failures.get(normalized, k -> new AtomicInteger()).incrementAndGet();
            throw ApiException.unauthorized(BAD_CREDENTIALS);
        }
        failuresByIp.invalidate(ipKey);
    }

    /** Guarda una contraseña nueva (ya comprobada la anterior). */
    @Transactional
    public void setPassword(User user, String newPassword) {
        validateNew(newPassword);
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        users.save(user);
    }

    static void validateNew(String password) {
        if (password.length() < MIN_PASSWORD_CHARS) {
            throw ApiException.badRequest("La contraseña debe tener al menos " + MIN_PASSWORD_CHARS + " caracteres.");
        }
        if (tooLong(password)) {
            throw ApiException.badRequest("La contraseña es demasiado larga: como mucho 72 caracteres (menos si lleva tildes o emojis).");
        }
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
