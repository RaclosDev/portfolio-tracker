package com.cartera.event;

import java.util.UUID;

/** Se publica dentro de la transacción que borra la cuenta; quien guarde algo del usuario en memoria lo olvida al confirmarse. */
public record UserDeletedEvent(UUID userId) {
}
