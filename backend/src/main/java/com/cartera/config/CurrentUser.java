package com.cartera.config;

import java.util.UUID;

/**
 * Usuario de la petición, tal como lo deja {@link JwtAuthFilter} en el contexto de seguridad.
 * Los controladores lo reciben con {@code @AuthenticationPrincipal CurrentUser user}.
 */
public record CurrentUser(UUID id, String email) {
}
