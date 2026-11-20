package com.cartera.service.market.composition;

import com.cartera.dto.market.FundHolding;
import com.cartera.service.market.MarketHttp;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** extraETF: las 10 mayores posiciones de un ETF por su ISIN. */
@Component
@Order(2)
public class ExtraEtfComposition implements CompositionSource {

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();

    public ExtraEtfComposition(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "extraETF";
    }

    static Result parse(JsonNode data) {
        if (data == null || !data.isArray()) return null;
        List<FundHolding> holdings = new ArrayList<>();
        for (JsonNode row : data) {
            String name = Holdings.str(row, "name");
            if (name == null) name = Holdings.str(row, "name_short");
            Double weight = Holdings.num(row, "weight");
            if (name != null && weight != null) holdings.add(new FundHolding(name, Holdings.isinOrNull(row, "isin"), null, weight / 100));
        }
        return Holdings.clean(holdings, null);
    }

    @Override
    public Result getComposition(Ref ref) {
        if (ref.isin() == null) return null;
        return parse(Holdings.fetchJson(http, client, "https://extraetf.com/api-v2/detail/holdings/?isin=" + ref.isin(),
                Map.of("Accept", "application/json"), id()));
    }
}
