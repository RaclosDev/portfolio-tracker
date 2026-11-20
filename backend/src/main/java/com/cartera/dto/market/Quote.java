package com.cartera.dto.market;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonInclude.Include;

/**
 * Cotización de un valor. {@code source}, {@code asOf}, {@code priceTime}, {@code isin} y {@code fallback}
 * solo vienen cuando la fuente los da.
 */
public record Quote(
        String symbol, String name, String currency, Double price, Double changePct, Double previousClose,
        Double low52, Double high52, String quoteType, String exchange, String marketState, String fetchedAt,
        @JsonInclude(Include.NON_NULL) String source,
        @JsonInclude(Include.NON_NULL) String sourceUrl,
        /** Fecha del valor liquidativo (fondos): su precio no cambia durante el día. */
        @JsonInclude(Include.NON_NULL) String asOf,
        /** Momento del último precio en la bolsa (ISO). */
        @JsonInclude(Include.NON_NULL) String priceTime,
        @JsonInclude(Include.NON_NULL) String isin,
        /** true si la fuente falló y se sirve el último dato guardado. */
        boolean stale,
        /** true si la consulta principal falló y el precio llega por la vía alternativa de la fuente. */
        @JsonInclude(Include.NON_DEFAULT) boolean fallback) {

    public Quote withSymbol(String symbol) {
        return new Quote(symbol, name, currency, price, changePct, previousClose, low52, high52, quoteType, exchange,
                marketState, fetchedAt, source, sourceUrl, asOf, priceTime, isin, stale, fallback);
    }

    public Quote withStale(boolean stale) {
        return new Quote(symbol, name, currency, price, changePct, previousClose, low52, high52, quoteType, exchange,
                marketState, fetchedAt, source, sourceUrl, asOf, priceTime, isin, stale, fallback);
    }
}
