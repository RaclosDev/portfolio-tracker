package com.cartera.dto.market;

import java.util.List;

/** Cierres de un periodo; {@code stale} si las fuentes fallaron y se sirve lo último guardado. */
public record HistoryResult(List<PricePoint> points, boolean stale) {
}
