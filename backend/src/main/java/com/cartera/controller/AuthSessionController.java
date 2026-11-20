package com.cartera.controller;

import com.cartera.dto.ErrorResponse;
import com.cartera.service.auth.SessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sesión con refresh token. Las rutas cuelgan de {@link RefreshTokenCookie#PATH}, el único sitio al que el navegador
 * manda la cookie; las protegen de CSRF SameSite=Strict y {@code CsrfOriginFilter}.
 */
@RestController
@RequestMapping(RefreshTokenCookie.PATH)
@RequiredArgsConstructor
public class AuthSessionController {

    private final SessionService sessions;

    /** Rota el refresh token de la cookie y devuelve un access token nuevo. */
    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(@CookieValue(name = RefreshTokenCookie.NAME, required = false) String refreshToken) {
        return sessions.refresh(refreshToken)
                .<ResponseEntity<?>>map(tokens -> LoginResponses.withSession(HttpStatus.OK, tokens))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .header(HttpHeaders.SET_COOKIE, RefreshTokenCookie.cleared())
                        .body(new ErrorResponse("La sesión ha caducado. Vuelve a iniciar sesión.")));
    }

    /** Cierra la sesión de la cookie y la borra. Responde 204 aunque no hubiera sesión. */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = RefreshTokenCookie.NAME, required = false) String refreshToken) {
        sessions.end(refreshToken);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, RefreshTokenCookie.cleared()).build();
    }
}
