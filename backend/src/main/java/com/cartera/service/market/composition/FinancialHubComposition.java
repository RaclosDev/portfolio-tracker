package com.cartera.service.market.composition;

import com.cartera.dto.market.FundHolding;
import com.cartera.service.market.MarketHttp;
import com.cartera.util.MarketSymbols;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * API pública de Financial Hub (sin clave, con límites bajos): el ISIN lleva al fondo y el fondo a su cartera
 * completa (la de Morningstar). Sin ISIN, encuentra el fondo por su ticker si no hay dudas.
 */
@Component
@Order(1)
public class FinancialHubComposition implements CompositionSource {

    private static final String API = "https://api.financial-hub.es";
    private static final int PAGE = 500;
    private static final Map<String, String> HEADERS =
            Map.of("Accept", "application/json", "User-Agent", "watchlist (uso personal)");
    private static final Pattern NUMERIC = Pattern.compile("^\\d+$");
    /** Acciones (E…), bonos (B…) y fondos cerrados cotizados (FC): la liquidez, divisas y derivados no son empresas. */
    private static final Pattern COUNTED = Pattern.compile("^(E|B|FC).*");

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.newClient(false);

    public FinancialHubComposition(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "Financial Hub";
    }

    private JsonNode json(String path) {
        return Holdings.fetchJson(http, client, API + path, HEADERS, id());
    }

    private List<JsonNode> funds(String query) {
        JsonNode found = json("/search?q=" + MarketHttp.enc(query) + "&identifierLookup=true&types=fund,etf");
        List<JsonNode> out = new ArrayList<>();
        JsonNode data = found == null ? null : found.get("data");
        if (data == null || !data.isArray()) return out;
        for (JsonNode h : data) {
            String type = Holdings.str(h, "type");
            if ("fund".equals(type) || "etf".equals(type)) out.add(h);
        }
        return out;
    }

    private static String idOf(JsonNode hit) {
        JsonNode id = hit.get("id");
        String s = id == null ? null : id.isNumber() ? String.valueOf(id.asLong()) : id.isString() ? id.asString() : null;
        return s != null && NUMERIC.matcher(s).matches() ? s : null;
    }

    /** Fondo que tiene esa clase: el ISIN puede ser el de la clase principal o el de otra (matchedChild). */
    private String fundId(String isin) {
        return funds(isin).stream()
                .filter(h -> isin.equals(Holdings.isinOrNull(h.get("primary"), "isin"))
                        || isin.equals(Holdings.isinOrNull(h.get("matchedChild"), "isin")))
                .findFirst().map(FinancialHubComposition::idOf).orElse(null);
    }

    /**
     * Fondo por ticker cuando no hay ISIN: solo cotizaciones con ese ticker exacto, preferidas las de su bolsa y
     * su divisa. Un mismo ticker puede ser de fondos distintos en bolsas distintas: si no queda uno solo, nada.
     */
    private JsonNode tickerHit(String symbol) {
        MarketSymbols.Ticker t = symbol == null ? null : MarketSymbols.tickerOf(symbol);
        if (t == null) return null;
        List<JsonNode> hits = funds(t.root()).stream()
                .filter(h -> idOf(h) != null && t.root().equals(upper(Holdings.str(h.get("matchedChild"), "symbol"))))
                .toList();
        hits = narrow(hits, "exchange", t.mic());
        hits = narrow(hits, "currency", t.currency());
        return hits.stream().map(FinancialHubComposition::idOf).distinct().count() == 1 ? hits.getFirst() : null;
    }

    private static List<JsonNode> narrow(List<JsonNode> hits, String field, String want) {
        if (want == null) return hits;
        List<JsonNode> narrowed = hits.stream()
                .filter(h -> want.equals(upper(Holdings.str(h.get("matchedChild"), field)))).toList();
        return narrowed.isEmpty() ? hits : narrowed;
    }

    private static String upper(String s) {
        return s == null ? null : s.toUpperCase(Locale.ROOT);
    }

    /** ISIN de la clase que cotiza con ese símbolo (SEC0 en Xetra → IE000I8KRLL9); null si no es un fondo o ETF conocido. */
    public String isinOf(String symbol) {
        JsonNode hit = tickerHit(symbol);
        if (hit == null) return null;
        String child = Holdings.isinOrNull(hit.get("matchedChild"), "isin");
        return child != null ? child : Holdings.isinOrNull(hit.get("primary"), "isin");
    }

    /** Posiciones de una o varias páginas (pesos en %). Una misma empresa puede venir en varias líneas: se suman. */
    static Result parse(List<JsonNode> pages) {
        if (pages.isEmpty() || pages.getFirst() == null || !pages.getFirst().path("data").isArray()) return null;
        Map<String, FundHolding> byKey = new LinkedHashMap<>();
        for (JsonNode page : pages) {
            for (JsonNode row : page.path("data")) {
                String name = Holdings.str(row, "name");
                String type = Objects.requireNonNullElse(upper(Holdings.str(row, "holdingType")), "");
                Double weight = Holdings.num(row, "weight");
                if (name == null || weight == null || weight <= 0 || !COUNTED.matcher(type).matches()) continue;
                String isin = Holdings.isinOrNull(row, "isin");
                String key = isin != null ? isin : name.toLowerCase(Locale.ROOT);
                FundHolding prev = byKey.get(key);
                byKey.put(key, prev != null ? prev.withWeight(prev.weight() + weight / 100)
                        : new FundHolding(name, isin, null, weight / 100));
            }
        }
        return Holdings.clean(new ArrayList<>(byKey.values()), Holdings.str(pages.getFirst(), "portfolioDate"),
                Holdings.MAX_FULL_HOLDINGS);
    }

    @Override
    public Result getComposition(Ref ref) {
        String code = ref.isin() != null ? ref.isin() : MarketSymbols.isinInSymbol(ref.symbol());
        String id;
        if (code != null) {
            id = fundId(code.toUpperCase(Locale.ROOT));
        } else {
            JsonNode hit = tickerHit(ref.symbol());
            id = hit != null ? idOf(hit) : null;
        }
        if (id == null) return null;
        // Por páginas de 500 (el máximo de la API), siguiendo nextCursor, que va por peso de mayor a menor.
        List<JsonNode> pages = new ArrayList<>();
        String cursor = null;
        do {
            JsonNode page = json("/funds/" + id + "/portfolio/holdings?pageSize=" + PAGE
                    + (cursor != null ? "&cursor=" + MarketHttp.enc(cursor) : ""));
            if (page == null) break;
            pages.add(page);
            cursor = Holdings.str(page, "nextCursor");
        } while (cursor != null && pages.size() * PAGE < Holdings.MAX_FULL_HOLDINGS);
        return parse(pages);
    }
}
