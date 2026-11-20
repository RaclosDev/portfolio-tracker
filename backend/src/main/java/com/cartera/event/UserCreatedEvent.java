package com.cartera.event;

import java.util.UUID;

/** Se publica dentro de la transacción que crea la cuenta, para que cada módulo prepare sus datos iniciales. */
public record UserCreatedEvent(UUID userId) {
}
