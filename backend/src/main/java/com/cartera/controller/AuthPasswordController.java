package com.cartera.controller;

import com.cartera.config.RateLimitingFilter;
import com.cartera.dto.AuthDtos.AccessTokenResponse;
import com.cartera.dto.AuthDtos.LoginRequest;
import com.cartera.dto.AuthDtos.RegisterRequest;
import com.cartera.service.auth.PasswordAuthService;
import com.cartera.service.auth.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth/password")
@RequiredArgsConstructor
public class AuthPasswordController {

    private final PasswordAuthService passwordAuth;
    private final SessionService sessions;
    private final RateLimitingFilter rateLimiting;

    @PostMapping("/login")
    public ResponseEntity<AccessTokenResponse> login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        return LoginResponses.withSession(HttpStatus.OK,
                sessions.start(passwordAuth.login(request.email(), request.password(), rateLimiting.clientIp(http))));
    }

    @PostMapping("/register")
    public ResponseEntity<AccessTokenResponse> register(@Valid @RequestBody RegisterRequest request) {
        return LoginResponses.withSession(HttpStatus.CREATED,
                sessions.start(passwordAuth.register(request.email(), request.password())));
    }
}
