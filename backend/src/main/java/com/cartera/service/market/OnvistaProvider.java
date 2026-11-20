package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.InstrumentHit;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import com.cartera.util.Isin;
import com.cartera.util.Words;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Cotizaciones de onvista.de (API JSON pública de su web). Cubre lo que Yahoo no tiene o tiene sin precio: ETF y
 * ETC en Xetra, Tradegate y otras bolsas alemanas, además de cualquier ISIN. Símbolos: «XETRA:JE00B588CD74» (bolsa
 * concreta) o el ISIN solo (bolsa principal según onvista). Solo precio actual: onvista no deja descargar su
 * histórico. También es catálogo de productos por nombre, ISIN o WKN.
 */
@Component
public class OnvistaProvider implements MarketDataProvider, InstrumentCatalog {

    public static final String SOURCE = "onvista";
    private static final String API = "https://api.onvista.de/api/v1";
    private static final long QUOTE_TTL_MS = 60_000L;
    private static final long INSTRUMENT_TTL_MS = 24 * 3_600_000L;
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");
    private static final Pattern BLOCKED = Pattern.compile("\\b(403|429)\\b");

    /** Prefijo del símbolo → código de bolsa de onvista. Solo las que Yahoo no cubre bien. */
    public record Venue(String code, String name) {
    }

    public static final Map<String, Venue> VENUES = orderedVenues();

    private static Map<String, Venue> orderedVenues() {
        Map<String, Venue> m = new LinkedHashMap<>();
        m.put("XETRA", new Venue("GER", "Xetra"));
        m.put("TRADEGATE", new Venue("GAT", "Tradegate"));
        m.put("FRANKFURT", new Venue("FRA", "Frankfurt"));
        m.put("GETTEX", new Venue("TRO", "gettex"));
        m.put("LSX", new Venue("LSX", "LS Exchange"));
        m.put("STUTTGART", new Venue("STU", "Stuttgart"));
        return java.util.Collections.unmodifiableMap(m);
    }

    /** Bolsa (null: la principal) e ISIN de un símbolo que cotiza onvista. */
    record Parsed(String venue, String isin) {
    }

    private record Cached(JsonNode value, long expires) {
    }

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();
    private final BoundedCache<Cached> instruments = new BoundedCache<>(512);
    private final BoundedCache<Cached> snapshots = new BoundedCache<>(512);

    public OnvistaProvider(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "onvista";
    }

    static Parsed parseSymbol(String symbol) {
        String s = symbol.trim().toUpperCase(Locale.ROOT);
        if (com.cartera.util.MarketSymbols.isVenueSymbol(s)) {
            int colon = s.indexOf(':');
            return new Parsed(s.substring(0, colon), s.substring(colon + 1));
        }
        return Isin.isIsin(s) ? new Parsed(null, s) : null;
    }

    private static String str(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v != null && v.isString() ? v.asString() : null;
    }

    private static Double num(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v != null && v.isNumber() && Double.isFinite(v.asDouble()) ? v.asDouble() : null;
    }

    static String quoteType(JsonNode i) {
        String type = str(i, "entityType");
        if ("STOCK".equals(type)) return "EQUITY";
        if ("FUND".equals(type)) {
            String display = str(i, "displayType");
            return display != null && display.toUpperCase(Locale.ROOT).contains("ETF") ? "ETF" : "MUTUALFUND";
        }
        if ("ETC_ETN_CERTIFICATE".equals(str(i, "entitySubType"))) return "ETF";
        return null;
    }

    /** Cotización de una bolsa concreta (la más reciente si hay varias) o la principal si no se pide ninguna. */
    static JsonNode pickQuote(JsonNode snapshot, String venue) {
        if (venue == null) {
            JsonNode q = snapshot.get("quote");
            return q != null && q.isObject() ? q : null;
        }
        Venue v = VENUES.get(venue);
        JsonNode list = snapshot.path("quoteList").path("list");
        if (v == null || !list.isArray()) return null;
        List<JsonNode> matches = new ArrayList<>();
        for (JsonNode q : list) {
            Double last = num(q, "last");
            if (v.code().equals(str(q.get("market"), "codeExchange")) && last != null && last != 0) matches.add(q);
        }
        return matches.stream()
                .max(Comparator.comparing(q -> Optional.ofNullable(str(q, "datetimeLast")).orElse("")))
                .orElse(null);
    }

    static Quote toQuote(JsonNode snapshot, String symbol) {
        Parsed parsed = parseSymbol(symbol);
        JsonNode instrument = snapshot.get("instrument");
        if (parsed == null || instrument == null || !parsed.isin().equals(str(instrument, "isin"))) return null;
        JsonNode q = pickQuote(snapshot, parsed.venue());
        Double price = num(q, "last");
        String currency = str(q, "isoCurrency");
        if (q == null || price == null || price <= 0 || currency == null || !CURRENCY.matcher(currency).matches()) return null;
        Double previous = num(q, "previousLast");
        Double prev = previous != null && previous > 0 ? previous : null;
        Double low = num(q, "lowPrice1Year");
        Double high = num(q, "highPrice1Year");
        // El rango anual solo si es coherente con el precio (onvista a veces lo arrastra de otra serie).
        boolean range = low != null && low != 0 && high != null && high != 0 && low <= price && price <= high;
        String datetime = str(q, "datetimeLast");
        return new Quote(symbol, str(instrument, "name"), currency, price, prev != null ? price / prev - 1 : null, prev,
                range ? low : null, range ? high : null, quoteType(instrument), str(q.get("market"), "name"), null,
                YahooProvider.ISO_MS.format(Instant.now()), SOURCE, str(instrument.get("urls"), "WEBSITE"),
                datetime != null && datetime.length() >= 10 ? datetime.substring(0, 10) : null, null, parsed.isin(),
                false, false);
    }

    private JsonNode json(String path) {
        HttpResponse<String> res = http.raw(client, API + path, Map.of("Accept", "application/json"));
        if (res.statusCode() / 100 != 2) throw new MarketSourceException("onvista HTTP " + res.statusCode());
        return http.readTree(res.body());
    }

    private List<JsonNode> query(String text, int limit) {
        JsonNode list = json("/instruments/query?limit=" + limit + "&searchValue=" + MarketHttp.enc(text)).get("list");
        List<JsonNode> out = new ArrayList<>();
        if (list == null || !list.isArray()) return out;
        for (JsonNode i : list) {
            if (str(i, "entityValue") != null && str(i, "entityType") != null && str(i, "name") != null) out.add(i);
        }
        return out;
    }

    private JsonNode instrument(String isin) {
        Cached hit = instruments.get(isin);
        if (hit != null && hit.expires() > System.currentTimeMillis()) return hit.value();
        JsonNode value = query(isin, 3).stream().filter(i -> isin.equals(str(i, "isin"))).findFirst().orElse(null);
        instruments.put(isin, new Cached(value, System.currentTimeMillis() + INSTRUMENT_TTL_MS));
        return value;
    }

    private JsonNode snapshot(JsonNode i) {
        String key = str(i, "entityType") + "/" + str(i, "entityValue");
        Cached hit = snapshots.get(key);
        if (hit != null && hit.expires() > System.currentTimeMillis()) return hit.value();
        JsonNode value = json("/instruments/" + MarketHttp.enc(str(i, "entityType")) + "/"
                + MarketHttp.enc(str(i, "entityValue")) + "/snapshot");
        snapshots.put(key, new Cached(value, System.currentTimeMillis() + QUOTE_TTL_MS));
        return value;
    }

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        List<Quote> results = new ArrayList<>();
        RuntimeException failure = null;
        for (String input : symbols) {
            String symbol = input.toUpperCase(Locale.ROOT);
            Parsed parsed = parseSymbol(symbol);
            if (parsed == null) continue;
            try {
                JsonNode instrument = instrument(parsed.isin());
                Quote quote = instrument != null ? toQuote(snapshot(instrument), symbol) : null;
                if (quote != null) results.add(quote);
            } catch (RuntimeException e) {
                failure = e;
                if (BLOCKED.matcher(String.valueOf(e.getMessage())).find()) break;
            }
        }
        if (failure != null && results.isEmpty()) throw failure;
        return results;
    }

    /** Productos por nombre, ISIN o WKN, sin pedir precios (la bolsa se elige después con search(isin)). */
    @Override
    public List<InstrumentHit> findInstruments(String query) {
        String q = query.trim();
        if (q.length() < 3 || q.length() > 100) return List.of();
        Parsed parsed = parseSymbol(q);
        List<JsonNode> found = new ArrayList<>();
        if (parsed != null) {
            JsonNode i = instrument(parsed.isin());
            if (i != null) found.add(i);
        } else {
            found.addAll(byName(q));
        }
        Map<String, InstrumentHit> hits = new LinkedHashMap<>();
        for (JsonNode i : found) {
            String isin = str(i, "isin");
            String type = quoteType(i);
            if (isin != null && Isin.isIsin(isin) && type != null) hits.putIfAbsent(isin, new InstrumentHit(isin, str(i, "name"), type));
        }
        return hits.values().stream().limit(8).toList();
    }

    /** Si un nombre largo no da nada, reintenta por parejas de palabras. */
    private List<JsonNode> byName(String q) {
        // Límite amplio: onvista rellena con futuros, que se descartan después.
        List<JsonNode> full = query(q, 30);
        List<String> pairs = Words.wordPairs(q);
        if (!full.isEmpty() || pairs.isEmpty()) return full;
        List<List<JsonNode>> lists = pairs.stream().map(p -> {
            try {
                return query(p, 10);
            } catch (RuntimeException e) {
                return List.<JsonNode>of();
            }
        }).toList();
        return Words.rankByWords(q, lists,
                i -> str(i, "isin") != null ? str(i, "isin") : str(i, "entityType") + "/" + str(i, "entityValue"),
                i -> str(i, "name"));
    }

    /** Por ISIN (o bolsa:ISIN): las bolsas alemanas donde cotiza. Por nombre no busca: eso lo hace findInstruments. */
    @Override
    public List<SymbolSearchResult> search(String query) {
        Parsed parsed = parseSymbol(query);
        if (parsed == null) return List.of();
        JsonNode instrument = instrument(parsed.isin());
        if (instrument == null || quoteType(instrument) == null) return List.of();
        JsonNode snap = snapshot(instrument);
        List<String> venues = parsed.venue() != null ? List.of(parsed.venue()) : List.copyOf(VENUES.keySet());
        String isin = str(instrument, "isin");
        return venues.stream().filter(v -> pickQuote(snap, v) != null)
                .map(v -> new SymbolSearchResult(v + ":" + isin, str(instrument, "name") + " · " + isin,
                        VENUES.get(v).name() + " (onvista)", quoteType(instrument)))
                .toList();
    }

    @Override
    public AnalystTargets getTargets(String symbol) {
        return null;
    }

    @Override
    public List<PricePoint> getHistory(String symbol, HistoryRange range) {
        return List.of();
    }
}
