package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.alerts.AlertDtos.AlertEntry;
import com.cartera.dto.alerts.AlertDtos.CheckResponse;
import com.cartera.dto.alerts.AlertDtos.TouchedOrderResponse;
import com.cartera.exception.ApiException;
import com.cartera.service.alerts.AlertService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

/** Historial de avisos, comprobación manual y órdenes que ha tocado el precio. */
@RestController
@RequiredArgsConstructor
public class AlertController {

    private final AlertService alerts;

    @GetMapping("/api/alerts")
    public List<AlertEntry> history(@AuthenticationPrincipal CurrentUser user) {
        return alerts.history(user.id());
    }

    /** «Comprobar ahora»: sin esperar a la siguiente vuelta y sin horarios de silencio. */
    @PostMapping("/api/alerts/check")
    public CheckResponse check(@AuthenticationPrincipal CurrentUser user) {
        return new CheckResponse(alerts.tick(user.id(), Instant.now(), true, null).size());
    }

    @GetMapping("/api/orders/touched")
    public List<TouchedOrderResponse> touched(@AuthenticationPrincipal CurrentUser user) {
        return alerts.touchedOrders(user.id());
    }

    @PostMapping("/api/orders/touched/check")
    public List<TouchedOrderResponse> checkTouched(@AuthenticationPrincipal CurrentUser user) {
        return alerts.checkTouched(user.id());
    }

    @DeleteMapping("/api/orders/touched/{itemId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismiss(@AuthenticationPrincipal CurrentUser user, @PathVariable String itemId) {
        alerts.dismissTouched(user.id(), positiveId(itemId));
    }

    static Long positiveId(String raw) {
        try {
            long id = Long.parseLong(raw);
            if (id > 0) return id;
        } catch (NumberFormatException e) {
            // cae al error de abajo
        }
        throw ApiException.badRequest("Identificador no válido.");
    }
}
