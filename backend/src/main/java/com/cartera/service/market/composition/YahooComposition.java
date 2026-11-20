package com.cartera.service.market.composition;

import com.cartera.dto.market.FundHolding;
import com.cartera.service.market.YahooProvider;
import com.cartera.util.Isin;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/** Yahoo: el módulo topHoldings de quoteSummary, solo para sus propios tickers. */
@Component
@Order(5)
public class YahooComposition implements CompositionSource {

    private final YahooProvider yahoo;

    public YahooComposition(YahooProvider yahoo) {
        this.yahoo = yahoo;
    }

    @Override
    public String id() {
        return "Yahoo Finance";
    }

    /** quoteSummary da los números como {@code {raw, fmt}}; se aceptan también sueltos. */
    private static Double number(JsonNode v) {
        if (v == null) return null;
        if (v.isNumber()) return v.asDouble();
        JsonNode raw = v.get("raw");
        return raw != null && raw.isNumber() ? raw.asDouble() : null;
    }

    static Result parse(JsonNode data) {
        JsonNode list = data == null ? null : data.get("holdings");
        if (list == null || !list.isArray()) return null;
        List<FundHolding> holdings = new ArrayList<>();
        for (JsonNode row : list) {
            String name = Holdings.str(row, "holdingName");
            Double weight = number(row.get("holdingPercent"));
            if (name != null && weight != null) holdings.add(new FundHolding(name, null, Holdings.str(row, "symbol"), weight));
        }
        return Holdings.clean(holdings, null);
    }

    @Override
    public Result getComposition(Ref ref) {
        String symbol = ref.symbol();
        if (symbol == null || symbol.contains(":") || Isin.isIsin(symbol)) return null;
        return parse(yahoo.topHoldings(symbol));
    }
}
