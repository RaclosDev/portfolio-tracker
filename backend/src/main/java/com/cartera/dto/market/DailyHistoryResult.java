package com.cartera.dto.market;

import java.util.List;

/** Cierres diarios en la escala de hoy (ya ajustados por splits); {@code stale} si las fuentes fallaron y se sirve lo último guardado. */
public record DailyHistoryResult(String currency, List<PricePoint> points, boolean stale) {

    public static DailyHistoryResult of(DailyHistory h, boolean stale) {
        return new DailyHistoryResult(h.currency(), h.points(), stale);
    }
}
