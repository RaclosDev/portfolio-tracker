package com.cartera.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

/**
 * Firma y verifica los access tokens (JWT HS256, cabecera {@code typ: at+jwt}, {@code sub} = id del usuario).
 * No se pueden revocar: duran poco y lo que mantiene la sesión es el refresh token ({@code SessionService}).
 */
@Component
@Slf4j
public class JwtUtil {

    private static final String ACCESS_TOKEN_TYPE = "at+jwt";
    private static final String EMAIL_CLAIM = "email";

    private final SecretKey key;
    private final Duration accessTokenTtl;

    public JwtUtil(@Value("${app.jwt.secret:}") String secret,
                   @Value("${app.jwt.access-minutes:15}") long accessMinutes,
                   Environment environment) {
        this.accessTokenTtl = Duration.ofMinutes(accessMinutes);
        boolean weak = secret == null || secret.isBlank() || secret.trim().getBytes(StandardCharsets.UTF_8).length < 32;
        if (weak) {
            if (environment.acceptsProfiles(Profiles.of("prod"))) {
                throw new IllegalStateException("En producción hay que configurar JWT_SECRET con al menos 32 bytes.");
            }
            this.key = Jwts.SIG.HS256.key().build();
            log.warn("JWT_SECRET no está configurado: se usa una clave efímera (las sesiones no sobreviven a un reinicio).");
        } else {
            this.key = Keys.hmacShaKeyFor(secret.trim().getBytes(StandardCharsets.UTF_8));
        }
    }

    public String generateAccessToken(UUID userId, String email) {
        Instant now = Instant.now();
        return Jwts.builder()
                .header().type(ACCESS_TOKEN_TYPE).and()
                .subject(userId.toString())
                .claim(EMAIL_CLAIM, email)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTokenTtl)))
                .signWith(key)
                .compact();
    }

    /** Id del usuario si la firma, la caducidad y el tipo son válidos. */
    public Optional<UUID> verify(String token) {
        Jws<Claims> jws;
        try {
            jws = Jwts.parser().verifyWith(key).build().parseSignedClaims(token);
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
        if (!ACCESS_TOKEN_TYPE.equals(jws.getHeader().getType()) || jws.getPayload().getExpiration() == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(jws.getPayload().getSubject()));
        } catch (IllegalArgumentException | NullPointerException e) {
            return Optional.empty();
        }
    }
}
