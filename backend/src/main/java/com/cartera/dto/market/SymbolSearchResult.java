package com.cartera.dto.market;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonInclude.Include;

public record SymbolSearchResult(String symbol, String name, String exchange, String type,
                                 @JsonInclude(Include.NON_NULL) String isin) {

    public SymbolSearchResult(String symbol, String name, String exchange, String type) {
        this(symbol, name, exchange, type, null);
    }
}
