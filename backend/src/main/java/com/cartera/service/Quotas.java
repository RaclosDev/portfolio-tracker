package com.cartera.service;

import com.cartera.exception.ApiException;

/**
 * Topes por cuenta. Están muy por encima de cualquier uso real de una persona y existen para que una sola cuenta (o una
 * copia de 12 MB restaurada una y otra vez) no llene la base de datos. Al pasarlos la API responde 422 con un mensaje
 * claro; lo ya guardado nunca se borra por superar un tope nuevo.
 */
public final class Quotas {

    public static final int MAX_LISTS = 50;
    /** Valores vigilados en total, sumando todas las listas. */
    public static final int MAX_WATCH_ITEMS = 2_000;
    public static final int MAX_INSTRUMENTS = 1_000;
    public static final int MAX_OPERATIONS = 20_000;
    /** Dispositivos con avisos push por cuenta. */
    public static final int MAX_PUSH_DEVICES = 10;
    /** Lo que ocupan, como mucho, las copias guardadas de una cuenta en la base de datos (se borran las más antiguas). */
    public static final long MAX_SNAPSHOT_BYTES = 64L * 1024 * 1024;

    private Quotas() {
    }

    /** Falla con un 422 si {@code count} supera el tope. */
    public static void check(long count, int max, String what) {
        if (count > max) throw ApiException.limit("Has llegado al límite de " + what + " por cuenta (" + max + ").");
    }
}
