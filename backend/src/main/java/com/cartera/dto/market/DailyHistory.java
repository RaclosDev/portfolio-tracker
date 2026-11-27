package com.cartera.dto.market;

import java.util.List;

/** Cierres diarios (fecha AAAA-MM-DD), ya ajustados por splits a la escala de hoy por la fuente. */
public record DailyHistory(String currency, List<PricePoint> points) {

    public static final DailyHistory EMPTY = new DailyHistory(null, List.of());
}
