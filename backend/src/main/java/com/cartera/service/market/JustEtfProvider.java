package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.DailyHistory;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Cotización e histórico de justetf.com (la API JSON de su web) por ISIN, siempre en euros y con el precio de Xetra.
 * Es la reserva de onvista para los símbolos que son un ISIN solo o «XETRA:ISIN», y además les da el histórico que
 * onvista no deja descargar. Las demás bolsas alemanas (Tradegate, gettex…) no son suyas: su precio es otro.
 */
@Component
public class JustEtfProvider implements MarketDataProvider {

    public static final String SOURCE = "justETF";
    private static final String API = "https://www.justetf.com/api/etfs";
    private static final long QUOTE_TTL_MS = 60_000L;

    private record Cached(Quote value, long expires) {
    }

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();
    private final BoundedCache<Cached> quotes = new BoundedCache<>(512);

    public JustEtfProvider(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "justetf";
    }

    /** ISIN de un símbolo que justETF puede cotizar (el ISIN solo o en Xetra), o null. */
    public static String isinOf(String symbol) {
        OnvistaProvider.Parsed parsed = OnvistaProvider.parseSymbol(symbol);
        return parsed != null && (parsed.venue() == null || "XETRA".equals(parsed.venue())) ? parsed.isin() : null;
    }

    private static Double raw(JsonNode n) {
        JsonNode v = n == null ? null : n.get("raw");
        return v != null && v.isNumber() && Double.isFinite(v.asDouble()) && v.asDouble() > 0 ? v.asDouble() : null;
    }

    static Quote toQuote(JsonNode data, String symbol) {
        String isin = isinOf(symbol);
        Double price = raw(data.get("latestQuote"));
        if (isin == null || price == null) return null;
        Double previous = raw(data.get("previousQuote"));
        Double low = raw(data.path("quoteLowHigh").get("low"));
        Double high = raw(data.path("quoteLowHigh").get("high"));
        boolean range = low != null && high != null && low <= price && price <= high;
        JsonNode venueNode = data.get("quoteTradingVenue");
        String venue = venueNode != null && venueNode.isString() && !venueNode.asString().isEmpty() ? venueNode.asString() : null;
        JsonNode date = data.get("latestQuoteDate");
        String asOf = date != null && date.isString() && date.asString().length() >= 10 ? date.asString().substring(0, 10) : null;
        return new Quote(symbol, null, "EUR", price, previous != null ? price / previous - 1 : null, previous,
                range ? low : null, range ? high : null, null,
                venue != null ? ("XETRA".equals(venue) ? "Xetra" : venue) + " (justETF)" : SOURCE, null,
                YahooProvider.ISO_MS.format(Instant.now()), SOURCE,
                "https://www.justetf.com/en/etf-profile.html?isin=" + isin, asOf, null, isin, false, false);
    }

    /** Cierres de la serie. justETF rellena fines de semana y festivos con el último cierre: se quitan sábados y domingos. */
    static List<PricePoint> closes(JsonNode chart) {
        List<PricePoint> out = new ArrayList<>();
        JsonNode series = chart == null ? null : chart.get("series");
        if (series == null || !series.isArray()) return out;
        for (JsonNode p : series) {
            Double c = raw(p.get("value"));
            JsonNode d = p.get("date");
            if (c == null || d == null || !d.isString()) continue;
            try {
                DayOfWeek weekday = LocalDate.parse(d.asString()).getDayOfWeek();
                if (weekday != DayOfWeek.SATURDAY && weekday != DayOfWeek.SUNDAY) out.add(new PricePoint(d.asString(), c));
            } catch (DateTimeParseException ignored) {
                // fecha malformada: se descarta el punto
            }
        }
        return out;
    }

    /** null si justETF no conoce el ISIN (404): no es un fallo de la fuente. */
    private JsonNode json(String path) {
        HttpResponse<String> res = http.raw(client, API + "/" + path, Map.of("Accept", "application/json"));
        if (res.statusCode() == 404) return null;
        if (res.statusCode() / 100 != 2) throw new MarketSourceException("justETF HTTP " + res.statusCode());
        return http.readTree(res.body());
    }

    private Quote quote(String symbol, String isin) {
        Cached hit = quotes.get(symbol);
        if (hit != null && hit.expires() > System.currentTimeMillis()) return hit.value();
        JsonNode data = json(isin + "/quote?locale=en&currency=EUR");
        Quote value = data != null ? toQuote(data, symbol) : null;
        quotes.put(symbol, new Cached(value, System.currentTimeMillis() + QUOTE_TTL_MS));
        return value;
    }

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        List<String> own = symbols.stream().map(s -> s.toUpperCase(Locale.ROOT)).filter(s -> isinOf(s) != null).toList();
        if (own.isEmpty()) return List.of();
        List<Quote> results = new ArrayList<>();
        RuntimeException failure = null;
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Quote>> futures = own.stream().map(s -> pool.submit(() -> quote(s, isinOf(s)))).toList();
            for (Future<Quote> f : futures) {
                try {
                    Quote q = f.get();
                    if (q != null) results.add(q);
                } catch (Exception e) {
                    Throwable cause = e.getCause() != null ? e.getCause() : e;
                    failure = cause instanceof RuntimeException r ? r : new MarketSourceException(cause.getMessage(), cause);
                }
            }
        }
        if (failure != null && results.isEmpty()) throw failure;
        return results;
    }

    private List<PricePoint> series(String symbol, LocalDate from) {
        String isin = isinOf(symbol);
        if (isin == null) return List.of();
        JsonNode data = json(isin + "/performance-chart?locale=en&currency=EUR&valuesType=MARKET_VALUE&reduceData=false"
                + "&includeDividends=false&features=DIVIDENDS&dateFrom=" + from + "&dateTo=" + LocalDate.now(ZoneOffset.UTC));
        return data != null ? closes(data) : List.of();
    }

    @Override
    public List<PricePoint> getHistory(String symbol, HistoryRange range) {
        return series(symbol, LocalDate.now(ZoneOffset.UTC).minusDays(range.days())).stream()
                .map(p -> new PricePoint(p.t() + "T00:00:00.000Z", p.c())).toList();
    }

    @Override
    public DailyHistory getDailyHistory(String symbol, LocalDate from) {
        List<PricePoint> points = series(symbol, from);
        String start = from.toString();
        return new DailyHistory(points.isEmpty() ? null : "EUR",
                points.stream().filter(p -> p.t().compareTo(start) >= 0).toList());
    }

    /** No busca: los ISIN ya los resuelven onvista y FT. */
    @Override
    public List<SymbolSearchResult> search(String query) {
        return List.of();
    }

    @Override
    public AnalystTargets getTargets(String symbol) {
        return null;
    }
}
