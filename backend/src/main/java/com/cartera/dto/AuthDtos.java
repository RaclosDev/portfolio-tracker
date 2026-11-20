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
            @NotBlank @Size(min = 12, max = 72, message = "La contraseña debe tener entre 12 y 72 caracteres.")
            String password) {
    }

    /** ID token que entrega Google Identity Services en el navegador. */
    public record GoogleLoginRequest(@NotBlank @Size(max = 4096) String credential) {
    }

    /** Access token recién emitido y su usuario. El refresh token va aparte, en su cookie. */
    public record AccessTokenResponse(String accessToken, UserResponse user) {
    }

    public record UserResponse(UUID id, String email, boolean googleLinked) {
        public static UserResponse of(com.cartera.model.User u) {
            return new UserResponse(u.getId(), u.getEmail(), u.getGoogleSubject() != null);
        }
    }

    /** Lo que necesita la pantalla de entrada antes de iniciar sesión. */
    public record AuthConfigResponse(String googleClientId, boolean registrationEnabled) {
    }
}
