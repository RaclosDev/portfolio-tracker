package com.cartera.controller;

import org.springframework.http.ResponseCookie;

import java.time.Duration;
import java.time.Instant;

/**
 * Cookie del refresh token: HttpOnly (el JavaScript no la lee), Secure con prefijo {@code __Secure-},
 * SameSite=Strict y Path={@value #PATH}, para que el navegador solo la mande al refresco y al logout.
 */
final class RefreshTokenCookie {

    static final String NAME = "__Secure-cartera_refresh";
    static final String PATH = "/api/auth/session";

    private RefreshTokenCookie() {
    }

    static String of(String refreshToken, Instant expiresAt) {
        Duration maxAge = Duration.between(Instant.now(), expiresAt);
        return base(refreshToken).maxAge(maxAge.isNegative() ? Duration.ZERO : maxAge).build().toString();
    }

    static String cleared() {
        return base("").maxAge(Duration.ZERO).build().toString();
    }

    private static ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(NAME, value).httpOnly(true).secure(true).sameSite("Strict").path(PATH);
    }
}
