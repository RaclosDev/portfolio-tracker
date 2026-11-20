package com.cartera.dto;

import com.cartera.model.VisitedSymbol;
import com.cartera.service.market.YahooProvider;

public record VisitedResponse(String symbol, String name, String exchange, String type, String isin, String visitedAt) {

    public static VisitedResponse of(VisitedSymbol v) {
        return new VisitedResponse(v.getSymbol(), v.getName(), v.getExchange(), v.getType(), v.getIsin(),
                YahooProvider.ISO_MS.format(v.getVisitedAt()));
    }
}
