package com.cartera.dto.market;

import java.util.List;

/** Qué lleva dentro un fondo o ETF. {@code asOf}: fecha de la composición (AAAA-MM-DD) si la fuente la indica. */
public record FundComposition(List<FundHolding> holdings, String asOf, String source, String fetchedAt) {

    public FundComposition withHoldings(List<FundHolding> value) {
        return new FundComposition(value, asOf, source, fetchedAt);
    }
}
