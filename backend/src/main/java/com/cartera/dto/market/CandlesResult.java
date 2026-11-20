package com.cartera.dto.market;

import java.util.List;

/** Velas del gráfico; {@code stale} si las fuentes fallaron y se sirve lo último guardado. */
public record CandlesResult(List<Candle> candles, boolean stale) {
}
