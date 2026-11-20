package com.cartera.config;

import com.cartera.event.UserCreatedEvent;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import com.cartera.service.auth.PasswordAuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Cuenta propietaria. Si no hay ninguna cuenta, la crea con {@code APP_OWNER_EMAIL}; si existe sin contraseña y
 * {@code APP_PASSWORD} está configurada, se la pone. Nunca cambia una contraseña que ya existe.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DataInitializer implements ApplicationRunner {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final ApplicationEventPublisher events;

    @Value("${app.owner.email:}")
    private String ownerEmail;

    @Value("${app.owner.password:}")
    private String ownerPassword;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (ownerEmail.isBlank()) return;
        String email = PasswordAuthService.normalizeEmail(ownerEmail);
        String hash = ownerPassword.isBlank() ? null : passwordEncoder.encode(ownerPassword);
        users.findByEmail(email).ifPresentOrElse(owner -> {
            if (owner.getPasswordHash() == null && hash != null) {
                owner.setPasswordHash(hash);
                log.info("Contraseña de la cuenta propietaria configurada desde APP_PASSWORD.");
            }
        }, () -> {
            if (users.count() > 0) return;
            User owner = users.save(User.builder().id(UUID.randomUUID()).email(email).passwordHash(hash).build());
            events.publishEvent(new UserCreatedEvent(owner.getId()));
            log.info("Creada la cuenta propietaria {}.", email);
        });
    }
}
