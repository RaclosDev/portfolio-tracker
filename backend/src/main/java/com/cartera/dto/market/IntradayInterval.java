package com.cartera.dto.market;

import com.fasterxml.jackson.annotation.JsonValue;

/** Intervalos de las velas intradía. */
public enum IntradayInterval {
    M1("1m"), M5("5m"), M15("15m"), M30("30m"), H1("1h"), H4("4h");

    private final String id;

    IntradayInterval(String id) {
        this.id = id;
    }

    @JsonValue
    public String id() {
        return id;
    }

    public static IntradayInterval of(String id) {
        for (IntradayInterval i : values()) if (i.id.equals(id)) return i;
        throw new IllegalArgumentException("Intervalo no válido: " + id);
    }
}
