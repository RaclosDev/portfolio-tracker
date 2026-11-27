package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.config.RateLimitingFilter;
import com.cartera.dto.AuthDtos.AccessTokenResponse;
import com.cartera.dto.AuthDtos.ChangePasswordRequest;
import com.cartera.dto.AuthDtos.DeleteAccountRequest;
import com.cartera.service.auth.AccountService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** La cuenta del usuario con sesión: contraseña, sesiones abiertas y borrado. */
@RestController
@RequestMapping("/api/users/me")
@RequiredArgsConstructor
public class AccountController {

    private final AccountService account;
    private final RateLimitingFilter rateLimiting;

    /** Cambia la contraseña y cierra las demás sesiones; devuelve una sesión nueva para este dispositivo. */
    @PostMapping("/password")
    public ResponseEntity<AccessTokenResponse> changePassword(@AuthenticationPrincipal CurrentUser current,
                                                              @Valid @RequestBody ChangePasswordRequest request,
                                                              HttpServletRequest http) {
        return LoginResponses.withSession(HttpStatus.OK, account.changePassword(current.id(),
                request.currentPassword(), request.newPassword(), rateLimiting.clientIp(http)));
    }

    /** Cierra todas las sesiones, también la de este dispositivo. */
    @DeleteMapping("/sessions")
    public ResponseEntity<Void> closeAllSessions(@AuthenticationPrincipal CurrentUser current) {
        account.closeAllSessions(current.id());
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, RefreshTokenCookie.cleared()).build();
    }

    /** Borra la cuenta y todos sus datos (POST y no DELETE: lleva la confirmación en el cuerpo). */
    @PostMapping("/delete")
    public ResponseEntity<Void> deleteAccount(@AuthenticationPrincipal CurrentUser current,
                                              @Valid @RequestBody DeleteAccountRequest request,
                                              HttpServletRequest http) {
        account.deleteAccount(current.id(), request.password(), request.credential(), rateLimiting.clientIp(http));
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, RefreshTokenCookie.cleared()).build();
    }
}
