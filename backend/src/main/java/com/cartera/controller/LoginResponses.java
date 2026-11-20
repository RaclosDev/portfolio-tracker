package com.cartera.controller;

import com.cartera.dto.AuthDtos.AccessTokenResponse;
import com.cartera.service.auth.SessionService.SessionTokens;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/** Respuesta común de cualquier forma de entrar: access token en el cuerpo y refresh token en su cookie. */
final class LoginResponses {

    private LoginResponses() {
    }

    static ResponseEntity<AccessTokenResponse> withSession(HttpStatus status, SessionTokens tokens) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.SET_COOKIE, RefreshTokenCookie.of(tokens.refreshToken(), tokens.refreshExpiresAt()))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new AccessTokenResponse(tokens.accessToken()));
    }
}
