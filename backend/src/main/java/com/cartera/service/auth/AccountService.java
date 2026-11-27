package com.cartera.service.auth;

import com.cartera.event.UserDeletedEvent;
import com.cartera.exception.ApiException;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import com.cartera.service.auth.SessionService.SessionTokens;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Lo que el usuario con sesión hace sobre su propia cuenta: cambiar la contraseña, cerrar todas las sesiones y
 * borrar la cuenta. Todas sus tablas cuelgan de {@code users(id)} con {@code ON DELETE CASCADE}, así que borrar la
 * fila borra todos sus datos.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AccountService {

    private final UserRepository users;
    private final PasswordAuthService passwordAuth;
    private final GoogleAuthService googleAuth;
    private final SessionService sessions;
    private final ApplicationEventPublisher events;

    /**
     * Cambia la contraseña, cierra todas las sesiones abiertas (también las de un posible intruso, que podían durar
     * 180 días) y abre una nueva para este dispositivo.
     */
    @Transactional
    public SessionTokens changePassword(UUID userId, String currentPassword, String newPassword, String ip) {
        User user = load(userId);
        if (user.getPasswordHash() == null) {
            throw ApiException.badRequest("Tu cuenta entra con Google y no tiene contraseña.");
        }
        passwordAuth.confirmPassword(user, currentPassword, ip);
        if (currentPassword.equals(newPassword)) {
            throw ApiException.badRequest("La contraseña nueva tiene que ser distinta de la actual.");
        }
        passwordAuth.setPassword(user, newPassword);
        sessions.endAll(userId);
        log.info("Contraseña de {} cambiada; sesiones anteriores cerradas.", userId);
        return sessions.start(user);
    }

    /** Cierra todas las sesiones del usuario, en todos sus dispositivos. */
    @Transactional
    public void closeAllSessions(UUID userId) {
        sessions.endAll(userId);
    }

    /** Borra la cuenta y todos sus datos. Se confirma con la contraseña o, si no tiene, con la cuenta de Google. */
    @Transactional
    public void deleteAccount(UUID userId, String password, String credential, String ip) {
        User user = load(userId);
        if (user.getPasswordHash() != null) {
            if (password == null || password.isBlank()) throw ApiException.badRequest("Escribe tu contraseña para confirmar.");
            passwordAuth.confirmPassword(user, password, ip);
        } else {
            googleAuth.confirm(user, credential);
        }
        sessions.endAll(userId);
        users.delete(user);
        users.flush();
        events.publishEvent(new UserDeletedEvent(userId));
        log.info("Cuenta {} borrada con todos sus datos.", userId);
    }

    private User load(UUID userId) {
        return users.findById(userId).orElseThrow(() -> ApiException.unauthorized("Tienes que iniciar sesión"));
    }
}
