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

/** onvista: las mayores posiciones de ETF y fondos por su ISIN. */
@Component
@Order(3)
public class OnvistaComposition implements CompositionSource {

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();

    public OnvistaComposition(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "onvista";
    }

    static Result parse(JsonNode data) {
        JsonNode block = data == null ? null : data.get("fundsHoldingList");
        JsonNode list = block == null ? null : block.get("list");
        if (list == null || !list.isArray()) return null;
        List<FundHolding> holdings = new ArrayList<>();
        for (JsonNode row : list) {
            JsonNode instrument = row.get("instrument");
            String name = Holdings.str(instrument, "name");
            Double pct = Holdings.num(row, "investmentPct");
            if (name != null && pct != null) holdings.add(new FundHolding(name, Holdings.isinOrNull(instrument, "isin"), null, pct / 100));
        }
        String date = Holdings.str(block, "dateMaintenance");
        return Holdings.clean(holdings, date != null && date.length() >= 10 ? date.substring(0, 10) : date);
    }

    @Override
    public Result getComposition(Ref ref) {
        if (ref.isin() == null) return null;
        return parse(Holdings.fetchJson(http, client, "https://api.onvista.de/api/v1/funds/ISIN:" + ref.isin() + "/snapshot",
                Map.of("Accept", "application/json"), id()));
    }
}
