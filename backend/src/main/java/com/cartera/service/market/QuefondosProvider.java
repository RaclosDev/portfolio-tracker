package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import com.cartera.util.Html;
import com.cartera.util.Isin;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Valor liquidativo y observaciones mensuales por ISIN. No ofrece cierres diarios para valorar una cartera. */
@Component
public class QuefondosProvider implements MarketDataProvider {

    public static final String SOURCE = "Quefondos / VDOS";
    private static final String ORIGIN = "https://www1.quefondos.com";
    private static final long HOUR_MS = 3_600_000L;
    /** Clases comprobadas por ISIN en Yahoo y en la ficha del fondo; no se deducen del nombre. */
    private static final Map<String, String> YAHOO_ISINS = Map.of(
            "0P00016YQ5.F", "ES0112611001",
            "0P0001F2GG.F", "ES0112602000",
            "0P00019OVT.F", "IE00BDGV0290",
            "0P0001OJNQ.F", "LU2441282899");
    private static final Pattern PARAGRAPH = Pattern.compile("<p\\b[^>]*>([\\s\\S]*?)</p>", Pattern.CASE_INSENSITIVE);
    private static final Pattern PAIR = Pattern.compile(
            "<span\\b[^>]*class=\"floatleft\"[^>]*>([\\s\\S]*?)</span>\\s*<span\\b[^>]*class=\"floatright\"[^>]*>([\\s\\S]*)</span>",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern NAV = Pattern.compile("^([\\d.,]+) ([A-Z]{3})$");
    private static final Pattern NAME = Pattern.compile("\\bvar\\s+label_fondo\\s*=\\s*(\"(?:\\\\.|[^\"\\\\])*\")\\s*;");
    private static final Pattern SERIES = Pattern.compile("\\bvar\\s+fondo\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;");
    private static final Pattern DATE = Pattern.compile("^(\\d{2})/(\\d{2})/(\\d{4})$");

    /** La ficha de un fondo: su valor liquidativo y la serie mensual (null si venía mal). */
    record FundPage(Quote quote, List<PricePoint> monthly) {
    }

    private record Cached(FundPage value, long expires) {
    }

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();
    private final Throttle throttle = new Throttle(500);
    private final BoundedCache<Cached> cache = new BoundedCache<>(512);

    public QuefondosProvider(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "quefondos";
    }

    private static String isinFor(String symbol) {
        String known = YAHOO_ISINS.get(symbol);
        return known != null ? known : Isin.isIsin(symbol) ? symbol : null;
    }

    /** dd/mm/aaaa (o mm/dd/aaaa) → AAAA-MM-DD si existe y no es futura. */
    private static String date(String value, boolean us) {
        Matcher m = DATE.matcher(value);
        if (!m.matches()) return null;
        String iso = m.group(3) + "-" + m.group(us ? 1 : 2) + "-" + m.group(us ? 2 : 1);
        return BorsaProvider.validPastDate(iso) ? iso : null;
    }

    FundPage parsePage(String html, String isin, String url) {
        Map<String, String> fields = new HashMap<>();
        Matcher p = PARAGRAPH.matcher(html);
        while (p.find()) {
            Matcher pair = PAIR.matcher(p.group(1));
            if (pair.find()) fields.put(Html.text(pair.group(1)), Html.text(pair.group(2)));
        }
        if (!Isin.isIsin(isin) || !isin.equals(fields.get("ISIN:"))) return null;
        Matcher nav = NAV.matcher(fields.getOrDefault("Valor liquidativo:", ""));
        double price = nav.matches() ? Html.decimal(nav.group(1)) : Double.NaN;
        String currency = nav.matches() ? nav.group(2) : null;
        String asOf = date(fields.getOrDefault("Fecha:", ""), false);
        Matcher nm = NAME.matcher(html);
        String name;
        try {
            JsonNode literal = nm.find() ? http.readTree(nm.group(1)) : null;
            name = literal != null && literal.isString() ? literal.asString() : null;
        } catch (RuntimeException e) {
            return null;
        }
        if (!Double.isFinite(price) || price <= 0 || currency == null || !currency.equals(fields.get("Divisa:"))
                || asOf == null || name == null || name.isBlank()) return null;
        String changeText = fields.getOrDefault("1 d&iacute;a:", fields.getOrDefault("1 día:", "")).replaceAll("%$", "");
        double change = Html.decimal(changeText);
        Quote quote = new Quote(isin, Html.text(name), currency, price, Double.isFinite(change) ? change / 100 : null,
                null, null, null, "MUTUALFUND", SOURCE, null, YahooProvider.ISO_MS.format(Instant.now()), SOURCE, url,
                asOf, null, isin, false, false);
        return new FundPage(quote, monthly(html, asOf, price));
    }

    /** La serie mensual de la ficha; una serie malformada no invalida el valor liquidativo comprobado. */
    private List<PricePoint> monthly(String html, String asOf, double price) {
        Matcher sm = SERIES.matcher(html);
        if (!sm.find()) return null;
        try {
            JsonNode raw = http.readTree(sm.group(1));
            if (!raw.isArray()) return null;
            TreeMap<String, Double> points = new TreeMap<>();
            for (JsonNode item : raw) {
                if (!item.isArray() || item.size() != 2 || !item.get(0).isString() || !item.get(1).isNumber()
                        || !Double.isFinite(item.get(1).asDouble()) || item.get(1).asDouble() <= 0) return null;
                String t = date(item.get(0).asString(), true);
                if (t == null) return null;
                // Algunas fichas etiquetan el último punto con una fecha posterior a la valoración: prevalece la del NAV.
                if (t.compareTo(asOf) > 0) continue;
                points.put(t, item.get(1).asDouble());
            }
            points.put(asOf, price);
            return points.entrySet().stream().map(e -> new PricePoint(e.getKey(), e.getValue())).toList();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private FundPage fund(String symbol) {
        String isin = isinFor(symbol);
        if (isin == null) return null;
        Cached cached = cache.get(isin);
        if (cached != null && cached.expires() > System.currentTimeMillis()) return cached.value();
        return throttle.run(() -> {
            Cached again = cache.get(isin);
            if (again != null && again.expires() > System.currentTimeMillis()) return again.value();
            String url = ORIGIN + "/es/fondos/ficha/index.html?isin=" + isin;
            HttpResponse<String> res = http.raw(client, url, Map.of());
            int status = res.statusCode();
            if (status / 100 != 2 && status != 404) throw new MarketSourceException("Quefondos HTTP " + status);
            FundPage value = status == 404 ? null : parsePage(res.body(), isin, url);
            if (status != 404 && value == null) throw new MarketSourceException("Ficha de Quefondos inválida: " + isin);
            cache.put(isin, new Cached(value, System.currentTimeMillis() + HOUR_MS));
            return value;
        });
    }

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        List<Quote> results = new java.util.ArrayList<>();
        RuntimeException failure = null;
        for (String input : symbols) {
            String symbol = input.toUpperCase(Locale.ROOT);
            try {
                FundPage data = fund(symbol);
                if (data != null) results.add(data.quote().withSymbol(symbol));
            } catch (RuntimeException e) {
                failure = e;
                if (MarketSourceException.isRateLimit(e)) break;
            }
        }
        if (failure != null && results.isEmpty()) throw failure;
        return results;
    }

    @Override
    public List<SymbolSearchResult> search(String query) {
        String input = query.trim().toUpperCase(Locale.ROOT);
        FundPage data = fund(input);
        if (data == null) return List.of();
        String isin = data.quote().isin();
        String symbol = YAHOO_ISINS.entrySet().stream().filter(e -> e.getValue().equals(isin)).map(Map.Entry::getKey)
                .findFirst().orElse(input);
        return List.of(new SymbolSearchResult(symbol, data.quote().name() + " · " + isin, SOURCE, "MUTUALFUND"));
    }

    @Override
    public List<PricePoint> getHistory(String symbol, HistoryRange range) {
        FundPage data = fund(symbol.toUpperCase(Locale.ROOT));
        if (data == null) return List.of();
        if (data.monthly() == null) throw new MarketSourceException("Histórico mensual de Quefondos inválido");
        int months = switch (range) {
            case M1 -> 1;
            case M3 -> 3;
            case M6 -> 6;
            case Y1 -> 12;
            case Y5 -> 60;
        };
        String cutoff = LocalDate.now(ZoneOffset.UTC).minusMonths(months).toString();
        return data.monthly().stream().filter(p -> p.t().compareTo(cutoff) >= 0).toList();
    }

    @Override
    public AnalystTargets getTargets(String symbol) {
        return null;
    }
}
