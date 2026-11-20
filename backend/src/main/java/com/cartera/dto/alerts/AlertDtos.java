package com.cartera.dto.alerts;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Avisos, órdenes tocadas y notificaciones Web Push. */
public final class AlertDtos {

    private AlertDtos() {
    }

    public enum AlertKind { reached, near, orderTouched, orderExpiring }

    /** Un aviso calculado en una comprobación. */
    public record Alert(AlertKind kind, long itemId, String symbol, String title, String body) {
    }

    /** Entrada del historial. {@code host}: quién lo mostró (siempre el servidor). */
    public record AlertEntry(String at, String kind, long itemId, String symbol, String title, String body,
                             String host) {
    }

    public record CheckResponse(int alerts) {
    }

    public record TouchedOrderResponse(
            long itemId, long listId, String symbol, String ticker, String isin, String name, String currency,
            double orderPrice, double price, Double shares, String broker, String at) {
    }

    public record PushKey(String publicKey, boolean enabled) {
    }

    public record PushDevice(long id, String label, String createdAt, String lastOkAt, String endpointHost) {
    }

    public record PushPayload(String title, String body, String tag, String url) {
    }

    public record SendResult(int sent, int failed) {
    }

    public record SubscribeRequest(@NotNull @Valid Subscription subscription, @Size(max = 60) String label) {
    }

    public record Subscription(
            @NotBlank @Size(max = 1000) @Pattern(regexp = "https://\\S+", message = "debe ser una URL https") String endpoint,
            @NotNull @Valid Keys keys) {
    }

    public record Keys(@NotBlank @Size(max = 200) String p256dh, @NotBlank @Size(max = 100) String auth) {
    }

    public record UnsubscribeRequest(@NotNull @Size(max = 1000) String endpoint) {
    }

    public record OkResponse(boolean ok) {
        public static final OkResponse OK = new OkResponse(true);
    }
}
