package com.cartera.service.auth;

import com.cartera.config.JwtUtil;
import com.cartera.model.RefreshToken;
import com.cartera.model.User;
import com.cartera.repository.RefreshTokenRepository;
import com.cartera.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

/**
 * Sesiones con refresh token opaco y rotatorio.
 * <ul>
 *   <li>Cada inicio de sesión abre una familia. Cada refresco gasta el token y entrega otro de la misma familia,
 *       con el plazo ({@code app.jwt.refresh-days}) contado de nuevo: la sesión dura mientras se use.</li>
 *   <li>Un token gastado hace menos de {@link #REUSE_GRACE} es un reintento tras perder la respuesta: se entrega
 *       otro sin revocar nada.</li>
 *   <li>Un token gastado hace más significa que alguien tiene una copia: se borra la familia entera.</li>
 *   <li>En la base solo está el SHA-256 del token; con 256 bits aleatorios no hace falta un hash lento.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SessionService {

    static final Duration REUSE_GRACE = Duration.ofSeconds(30);
    /** Cuánto se guardan los tokens rotados para detectar que se reutilizan. */
    static final Duration REUSE_DETECTION_WINDOW = Duration.ofDays(30);
    private static final int TOKEN_BYTES = 32;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RefreshTokenRepository tokens;
    private final UserRepository users;
    private final JwtUtil jwtUtil;

    @Value("${app.jwt.refresh-days:180}")
    private long refreshDays;

    /** Abre una sesión nueva. */
    @Transactional
    public SessionTokens start(User user) {
        return issue(user, UUID.randomUUID(), Instant.now());
    }

    /** Gasta el refresh token y entrega el siguiente; vacío si no vale (desconocido, caducado o reutilizado). */
    @Transactional
    public Optional<SessionTokens> refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) return Optional.empty();
        Optional<RefreshToken> found = tokens.findByTokenHashForUpdate(hash(refreshToken));
        if (found.isEmpty()) return Optional.empty();
        RefreshToken token = found.get();
        Instant now = Instant.now();
        if (!now.isBefore(token.getExpiresAt())) return Optional.empty();
        Optional<User> user = users.findById(token.getUserId());
        if (user.isEmpty()) return Optional.empty();
        if (token.getRotatedAt() != null) {
            if (now.isBefore(token.getRotatedAt().plus(REUSE_GRACE))) {
                log.info("Reintento de refresco dentro del margen (familia {}).", token.getFamilyId());
                return Optional.of(issue(user.get(), token.getFamilyId(), now));
            }
            log.warn("Reutilización de un refresh token ya rotado (usuario {}): se cierra la sesión.", token.getUserId());
            tokens.deleteFamily(token.getFamilyId());
            return Optional.empty();
        }
        token.setRotatedAt(now);
        return Optional.of(issue(user.get(), token.getFamilyId(), now));
    }

    /** Logout: borra la familia del token. Un token desconocido no hace nada. */
    @Transactional
    public void end(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) return;
        tokens.findByTokenHashForUpdate(hash(refreshToken)).ifPresent(t -> tokens.deleteFamily(t.getFamilyId()));
    }

    /** Borra cada noche las sesiones caducadas y los tokens rotados que ya no sirven para detectar reutilización. */
    @Scheduled(cron = "0 15 4 * * *")
    @Transactional
    public void purgeExpired() {
        Instant now = Instant.now();
        int deleted = tokens.deleteStale(now, now.minus(REUSE_DETECTION_WINDOW));
        if (deleted > 0) log.info("Borrados {} refresh tokens caducados o rotados.", deleted);
    }

    private SessionTokens issue(User user, UUID familyId, Instant now) {
        byte[] raw = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(raw);
        String refreshToken = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        Instant expiresAt = now.plus(Duration.ofDays(refreshDays));
        tokens.save(RefreshToken.builder()
                .userId(user.getId())
                .familyId(familyId)
                .tokenHash(hash(refreshToken))
                .expiresAt(expiresAt)
                .createdAt(now)
                .build());
        return new SessionTokens(jwtUtil.generateAccessToken(user.getId(), user.getEmail()), refreshToken, expiresAt);
    }

    static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public record SessionTokens(String accessToken, String refreshToken, Instant refreshExpiresAt) {
    }
}
