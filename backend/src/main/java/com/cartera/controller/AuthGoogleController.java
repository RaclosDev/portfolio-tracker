package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.AuthDtos.AccessTokenResponse;
import com.cartera.dto.AuthDtos.GoogleLoginRequest;
import com.cartera.dto.AuthDtos.UserResponse;
import com.cartera.model.User;
import com.cartera.service.auth.GoogleAuthService;
import com.cartera.service.auth.SessionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Entrar con Google Identity Services: el navegador manda el ID token que le da el botón de Google. */
@RestController
@RequestMapping("/api/auth/google")
@RequiredArgsConstructor
public class AuthGoogleController {

    private final GoogleAuthService googleAuth;
    private final SessionService sessions;

    @PostMapping("/login")
    public ResponseEntity<AccessTokenResponse> login(@Valid @RequestBody GoogleLoginRequest request) {
        return LoginResponses.withSession(HttpStatus.OK, sessions.start(googleAuth.login(request.credential())));
    }

    @PostMapping("/link")
    public UserResponse link(@AuthenticationPrincipal CurrentUser current, @Valid @RequestBody GoogleLoginRequest request) {
        User user = googleAuth.link(current.id(), request.credential());
        return new UserResponse(user.getId(), user.getEmail(), true);
    }
}
