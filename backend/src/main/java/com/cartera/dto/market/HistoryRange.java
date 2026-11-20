package com.cartera.dto.market;

import com.fasterxml.jackson.annotation.JsonValue;

/** Periodos del gráfico histórico. */
public enum HistoryRange {
    M1("1m", 31), M3("3m", 92), M6("6m", 183), Y1("1y", 366), Y5("5y", 5 * 366);

    private final String id;
    private final int days;

    HistoryRange(String id, int days) {
        this.id = id;
        this.days = days;
    }

    @JsonValue
    public String id() {
        return id;
    }

    public int days() {
        return days;
    }

    public static HistoryRange of(String id) {
        for (HistoryRange r : values()) if (r.id.equals(id)) return r;
        throw new IllegalArgumentException("Periodo no válido: " + id);
    }
}
