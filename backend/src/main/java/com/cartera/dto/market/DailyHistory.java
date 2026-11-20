package com.cartera.dto.market;

import java.util.List;

/** Cierres diarios (fecha AAAA-MM-DD) sin ajuste retrospectivo por splits. */
public record DailyHistory(String currency, List<PricePoint> points) {

    public static final DailyHistory EMPTY = new DailyHistory(null, List.of());
}
