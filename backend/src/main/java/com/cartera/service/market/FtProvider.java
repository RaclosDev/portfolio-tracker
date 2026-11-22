package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.DailyHistory;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Cotizaciones e histórico de markets.ft.com (las API JSON de su web). Busca por nombre, ISIN o símbolo y cubre
 * bolsas que Yahoo no tiene o tiene sin gráfico (p. ej. GZUR en Xetra), además de fondos por ISIN y divisa.
 * Símbolos: «FT:» + el símbolo de FT, p. ej. «FT:GZUR:GER:EUR», «FT:ITX:MCE», «FT:IE00B03HCZ61:EUR».
 */
@Component
public class FtProvider implements MarketDataProvider {

    public static final String SOURCE = "FT Markets";
    private static final String ORIGIN = "https://markets.ft.com/data";
    private static final long QUOTE_TTL_MS = 60_000L;
    private static final Pattern FT_SYMBOL = Pattern.compile("^FT:([A-Z0-9][A-Z0-9.:-]{0,27})$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}.*");
    private static final Pattern CURRENCY = Pattern.compile("^[A-Za-z]{3}$");
    private static final Pattern XID = Pattern.compile("^\\d+$");
    private static final Map<String, String> TYPES = Map.of("Equities", "EQUITY", "ETFs", "ETF", "Funds", "MUTUALFUND");
    /** Códigos de bolsa de FT más habituales; el resto se muestra con su código. */
    private static final Map<String, String> VENUES = Map.ofEntries(
            Map.entry("GER", "Xetra"), Map.entry("FRA", "Fráncfort"), Map.entry("STU", "Stuttgart"),
            Map.entry("DUS", "Düsseldorf"), Map.entry("MUN", "Múnich"), Map.entry("BER", "Berlín"),
            Map.entry("HAM", "Hamburgo"), Map.entry("LSE", "Londres"), Map.entry("MCE", "Madrid"),
            Map.entry("MIL", "Milán"), Map.entry("PAR", "París"), Map.entry("AEX", "Ámsterdam"),
            Map.entry("BRU", "Bruselas"), Map.entry("LIS", "Lisboa"), Map.entry("SWX", "Suiza"),
            Map.entry("VIE", "Viena"), Map.entry("NYQ", "NYSE"), Map.entry("NSQ", "Nasdaq"), Map.entry("NMQ", "Nasdaq"),
            Map.entry("PCQ", "NYSE Arca"), Map.entry("TOR", "Toronto"), Map.entry("TYO", "Tokio"));

    /** Identificador interno de FT (xid) y tipo de un símbolo: los da la búsqueda; el gráfico pide el xid. */
    private record Known(String xid, String type) {
    }

    private record Security(String symbol, String name, String xid, String assetClass) {
    }

    private record Cached(Quote value, long expires) {
    }

    /**
     * Bolsas con subasta de cierre y su sufijo en Yahoo. FT da como cierre la última operación antes de la subasta
     * (RARE en Milán el 20/11/2026: 34,165 a las 17:29 frente a 34,045 de la subasta). El cierre oficial, el que dan
     * el banco y Yahoo, es el de la subasta, así que se toma del gráfico de Yahoo del mismo valor en la misma bolsa.
     */
    private static final Map<String, String> AUCTION_VENUES = Map.of(
            "MIL", "MI", "PAR", "PA", "AEX", "AS", "BRU", "BR", "LIS", "LS", "MCE", "MC");
    /** Diferencia máxima para dar por buena la corrección: más es otro valor o un dato malo, y se deja el de FT. */
    private static final double MAX_AUCTION_GAP = 0.03;

    private final MarketHttp http;
    private final YahooProvider yahoo;
    private final BoundedCache<Known> xids = new BoundedCache<>(2048);
    private final BoundedCache<Cached> quotes = new BoundedCache<>(512);

    public FtProvider(MarketHttp http, YahooProvider yahoo) {
        this.http = http;
        this.yahoo = yahoo;
    }

    @Override
    public String id() {
        return "ft";
    }

    public static String parseFtSymbol(String symbol) {
        Matcher m = FT_SYMBOL.matcher(symbol.trim().toUpperCase(Locale.ROOT));
        return m.matches() ? m.group(1) : null;
    }

    /** Los fondos no cotizan en bolsa: su símbolo es ISIN:divisa. */
    private static String exchange(String code, String type) {
        return code != null && !"MUTUALFUND".equals(type) ? VENUES.getOrDefault(code, code) + " (FT)" : SOURCE;
    }

    private static JsonNode element(JsonNode series) {
        JsonNode elements = series == null ? null : series.get("Elements");
        return elements != null && elements.isArray() && !elements.isEmpty() ? elements.get(0) : null;
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v != null && v.isString() ? v.asString() : null;
    }

    /** Cierres positivos de la serie, con su fecha (AAAA-MM-DD). */
    static List<PricePoint> closes(JsonNode series) {
        List<PricePoint> out = new ArrayList<>();
        JsonNode element = element(series);
        JsonNode values = null;
        JsonNode components = element == null ? null : element.get("ComponentSeries");
        if (components != null && components.isArray()) {
            for (JsonNode c : components) if ("Close".equals(text(c, "Type"))) values = c.get("Values");
        }
        JsonNode dates = series == null ? null : series.get("Dates");
        if (values == null || !values.isArray() || dates == null || !dates.isArray()) return out;
        for (int i = 0; i < dates.size(); i++) {
            JsonNode d = dates.get(i);
            JsonNode c = values.get(i);
            if (d == null || !d.isString() || !DATE.matcher(d.asString()).matches() || c == null || !c.isNumber()) continue;
            double v = c.asDouble();
            if (Double.isFinite(v) && v > 0) out.add(new PricePoint(d.asString().substring(0, 10), v));
        }
        return out;
    }

    static Quote toQuote(JsonNode series, String symbol, String type) {
        return toQuote(series, closes(series), symbol, type);
    }

    static Quote toQuote(JsonNode series, List<PricePoint> points, String symbol, String type) {
        JsonNode element = element(series);
        String currency = text(element, "Currency");
        if (element == null || points.isEmpty() || currency == null || !CURRENCY.matcher(currency).matches()) return null;
        PricePoint last = points.getLast();
        Double previous = points.size() > 1 ? points.get(points.size() - 2).c() : null;
        double low = points.stream().mapToDouble(PricePoint::c).min().orElse(last.c());
        double high = points.stream().mapToDouble(PricePoint::c).max().orElse(last.c());
        return new Quote(symbol, text(element, "CompanyName"), currency, last.c(),
                previous != null ? last.c() / previous - 1 : null, previous, low, high, type,
                exchange(text(element, "ExchangeId"), type), null, YahooProvider.ISO_MS.format(Instant.now()), SOURCE,
                null, last.t(), null, null, false, false);
    }

    private List<Security> securities(String query) {
        JsonNode data = http.getJson(ORIGIN + "/searchapi/searchsecurities?query=" + MarketHttp.enc(query));
        JsonNode list = data.path("data").get("security");
        List<Security> found = new ArrayList<>();
        if (list == null || !list.isArray()) return found;
        for (JsonNode s : list) {
            String symbol = text(s, "symbol");
            String name = text(s, "name");
            String xid = text(s, "xid");
            if (symbol == null || name == null || xid == null || !XID.matcher(xid).matches()) continue;
            Security sec = new Security(symbol, name, xid, text(s, "assetClass"));
            found.add(sec);
            xids.put(symbol.toUpperCase(Locale.ROOT), new Known(xid, TYPES.get(sec.assetClass())));
        }
        return found;
    }

    private Known known(String ftSymbol) {
        if (xids.get(ftSymbol) == null) securities(ftSymbol);
        return xids.get(ftSymbol);
    }

    private JsonNode series(String ftSymbol, long days) {
        Known k = known(ftSymbol);
        if (k == null) return null;
        Map<String, Object> body = Map.of("days", days, "dataNormalized", false, "dataPeriod", "Day",
                "dataInterval", 1, "realtime", false, "yFormat", "0.###", "returnDateType", "ISO8601",
                "elements", List.of(Map.of("Type", "price", "Symbol", k.xid(), "OverlayIndicators", List.of(),
                        "Params", Map.of())));
        return http.postJson(ORIGIN + "/chartapi/series", body, Map.of("Accept", "application/json"));
    }

    private Quote quote(String symbol, String ftSymbol) {
        Cached hit = quotes.get(symbol);
        if (hit != null && hit.expires() > System.currentTimeMillis()) return hit.value();
        JsonNode s = series(ftSymbol, 366);
        Known k = xids.get(ftSymbol);
        Quote value = null;
        if (s != null) {
            List<PricePoint> points = withAuctionCloses(closes(s), auctionCloses(ftSymbol, text(element(s), "Currency"),
                    LocalDate.now(ZoneOffset.UTC).minusDays(10)));
            value = toQuote(s, points, symbol, k != null ? k.type() : null);
        }
        quotes.put(symbol, new Cached(value, System.currentTimeMillis() + QUOTE_TTL_MS));
        return value;
    }

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        List<String> own = symbols.stream().map(s -> s.toUpperCase(Locale.ROOT)).filter(s -> parseFtSymbol(s) != null).toList();
        if (own.isEmpty()) return List.of();
        List<Quote> results = new ArrayList<>();
        RuntimeException failure = null;
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Quote>> futures = own.stream().map(s -> pool.submit(() -> quote(s, parseFtSymbol(s)))).toList();
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

    /** Por nombre, ISIN o símbolo de FT. Los símbolos de otras fuentes (XETRA:…, BORSA:…) no son suyos. */
    @Override
    public List<SymbolSearchResult> search(String query) {
        String q = query.trim();
        String ftSymbol = parseFtSymbol(q);
        if (q.length() < 3 || q.length() > 100 || (q.contains(":") && ftSymbol == null)) return List.of();
        return securities(ftSymbol != null ? ftSymbol : q).stream()
                .filter(s -> TYPES.containsKey(s.assetClass())
                        && (ftSymbol == null || s.symbol().toUpperCase(Locale.ROOT).equals(ftSymbol)))
                .limit(8)
                .map(s -> {
                    String type = TYPES.get(s.assetClass());
                    String[] parts = s.symbol().split(":");
                    return new SymbolSearchResult("FT:" + s.symbol().toUpperCase(Locale.ROOT), s.name(),
                            exchange(parts.length > 1 ? parts[1] : null, type), type);
                })
                .toList();
    }

    @Override
    public List<PricePoint> getHistory(String symbol, HistoryRange range) {
        String ftSymbol = parseFtSymbol(symbol);
        JsonNode s = ftSymbol != null ? series(ftSymbol, range.days()) : null;
        if (s == null) return List.of();
        Map<String, Double> auction = auctionCloses(ftSymbol, text(element(s), "Currency"),
                LocalDate.now(ZoneOffset.UTC).minusDays(range.days()));
        return withAuctionCloses(closes(s), auction).stream()
                .map(p -> new PricePoint(p.t() + "T00:00:00.000Z", p.c())).toList();
    }

    // shortcut: FT no publica los splits, así que los cierres anteriores a uno salen ya ajustados; si un valor seguido
    // por FT hace split, habrá que leer sus eventos para deshacer el ajuste como en Yahoo.
    @Override
    public DailyHistory getDailyHistory(String symbol, LocalDate from) {
        String ftSymbol = parseFtSymbol(symbol);
        long days = ChronoUnit.DAYS.between(from, LocalDate.now(ZoneOffset.UTC)) + 1;
        JsonNode s = ftSymbol != null && days > 0 ? series(ftSymbol, days) : null;
        if (s == null) return DailyHistory.EMPTY;
        String start = from.toString();
        String currency = text(element(s), "Currency");
        return new DailyHistory(currency, withAuctionCloses(closes(s), auctionCloses(ftSymbol, currency, from)).stream()
                .filter(p -> p.t().compareTo(start) >= 0).toList());
    }

    /** Símbolo de Yahoo del mismo valor en la misma bolsa (RARE:MIL:EUR → RARE.MI), o null si la bolsa no tiene subasta. */
    static String yahooAuctionSymbol(String ftSymbol) {
        String[] parts = ftSymbol.split(":");
        if (parts.length < 2 || !parts[0].matches("[A-Z0-9][A-Z0-9-]*")) return null;
        String suffix = AUCTION_VENUES.get(parts[1]);
        return suffix != null ? parts[0] + "." + suffix : null;
    }

    /** Cierres de subasta por fecha desde `from`; vacío si la bolsa no tiene, la divisa no casa o Yahoo falla. */
    private Map<String, Double> auctionCloses(String ftSymbol, String currency, LocalDate from) {
        String ySymbol = yahooAuctionSymbol(ftSymbol);
        if (ySymbol == null || currency == null) return Map.of();
        try {
            DailyHistory h = yahoo.getDailyHistory(ySymbol, from);
            if (!currency.equalsIgnoreCase(h.currency())) return Map.of();
            Map<String, Double> out = new HashMap<>();
            for (PricePoint p : h.points()) out.put(p.t(), p.c());
            return out;
        } catch (RuntimeException e) {
            return Map.of(); // sin Yahoo se queda el dato de FT, que solo difiere en la subasta
        }
    }

    /** Cambia cada cierre de FT por el de la subasta del mismo día si están cerca (si no, es otro valor o un dato malo). */
    static List<PricePoint> withAuctionCloses(List<PricePoint> ft, Map<String, Double> auction) {
        if (auction.isEmpty()) return ft;
        return ft.stream().map(p -> {
            Double a = auction.get(p.t());
            return a != null && a > 0 && Math.abs(a / p.c() - 1) <= MAX_AUCTION_GAP ? new PricePoint(p.t(), a) : p;
        }).toList();
    }

    @Override
    public AnalystTargets getTargets(String symbol) {
        return null;
    }
}
