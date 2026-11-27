package com.cartera.dto.market;

import java.util.List;

/** Dividendos del valor; {@code stale} si las fuentes fallaron y se sirve lo último guardado. */
public record DividendsResult(List<Dividend> dividends, boolean stale) {
}
