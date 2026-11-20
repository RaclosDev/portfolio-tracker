package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.AuthDtos.AuthConfigResponse;
import com.cartera.dto.AuthDtos.UserResponse;
import com.cartera.exception.ApiException;
import com.cartera.repository.UserRepository;
import com.cartera.service.auth.GoogleCredentialVerifier;
import com.cartera.service.auth.PasswordAuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class UserController {

    private final UserRepository users;
    private final GoogleCredentialVerifier google;
    private final PasswordAuthService passwordAuth;

    @GetMapping("/api/users/me")
    public UserResponse me(@AuthenticationPrincipal CurrentUser current) {
        return users.findById(current.id())
                .map(u -> new UserResponse(u.getId(), u.getEmail(), u.getGoogleSubject() != null))
                .orElseThrow(() -> ApiException.unauthorized("Tienes que iniciar sesión"));
    }

    /** Pública: la pantalla de entrada la necesita para pintar el botón de Google y el registro. */
    @GetMapping("/api/auth/config")
    public AuthConfigResponse config() {
        return new AuthConfigResponse(google.enabled() ? google.clientId() : null, passwordAuth.registrationEnabled());
    }
}
