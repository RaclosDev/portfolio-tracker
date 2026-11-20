package com.cartera.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/** Peticiones y respuestas del acceso (contraseña, Google y sesión). */
public final class AuthDtos {

    private AuthDtos() {
    }

    public record LoginRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 200) String password) {
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(min = 12, max = 200, message = "La contraseña debe tener entre 12 y 200 caracteres.")
            String password) {
    }

    /** ID token que entrega Google Identity Services en el navegador. */
    public record GoogleLoginRequest(@NotBlank @Size(max = 4096) String credential) {
    }

    /** Access token recién emitido. El refresh token va aparte, en su cookie. */
    public record AccessTokenResponse(String accessToken) {
    }

    public record UserResponse(UUID id, String email, boolean googleLinked) {
    }

    /** Lo que necesita la pantalla de entrada antes de iniciar sesión. */
    public record AuthConfigResponse(String googleClientId, boolean registrationEnabled) {
    }
}
