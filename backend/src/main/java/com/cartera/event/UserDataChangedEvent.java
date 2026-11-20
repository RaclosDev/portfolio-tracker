package com.cartera.event;

import java.util.UUID;

/**
 * Los datos de un usuario han cambiado (listas, valores, órdenes, ajustes, copias…). Lo publica
 * {@link com.cartera.config.UserDataChangedInterceptor} al terminar cada petición que modifica algo; quien guarde
 * una copia en memoria de esos datos la descarta y la recarga de la base de datos.
 */
public record UserDataChangedEvent(UUID userId) {
}
