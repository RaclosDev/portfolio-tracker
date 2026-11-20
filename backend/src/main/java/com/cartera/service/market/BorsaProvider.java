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
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Valor liquidativo público de fondos en Borsa Italiana: la ficha solo da el último dato, no una serie histórica. */
@Component
public class BorsaProvider implements MarketDataProvider {

    public static final String SOURCE = "Borsa Italiana / FIDA";
    private static final String ORIGIN = "https://www.borsaitaliana.it";
    private static final long HOUR_MS = 3_600_000L;
    /** El buscador de Borsa no indexa todos los ISIN. Cada vínculo se valida de nuevo en la ficha. */
    private static final Map<String, String> FUND_IDS = Map.of("IE00B3VXGD32", "2FADB302467");
    private static final Pattern BORSA_SYMBOL = Pattern.compile("^BORSA:(2FADB\\d+)$");
    private static final Pattern FUND_CODE = Pattern.compile("^2FADB\\d+$");
    private static final Pattern ROW = Pattern.compile("<tr\\b[^>]*>([\\s\\S]*?)</tr>", Pattern.CASE_INSENSITIVE);
    private static final Pattern CELL = Pattern.compile("<t[dh]\\b[^>]*>([\\s\\S]*?)</t[dh]>", Pattern.CASE_INSENSITIVE);
    private static final Pattern H1 = Pattern.compile("<h1\\b[^>]*>([\\s\\S]*?)</h1>", Pattern.CASE_INSENSITIVE);
    private static final Pattern DATE = Pattern.compile("^(\\d{2})/(\\d{2})/(\\d{2}|\\d{4})$");
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");

    private record Cached(Quote value, long expires) {
    }

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();
    private final Throttle throttle = new Throttle(500);
    private final BoundedCache<Cached> cache = new BoundedCache<>(512);

    public BorsaProvider(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "borsa";
    }

    private static String fundCode(String symbol) {
        String known = FUND_IDS.get(symbol);
        if (known != null) return known;
        Matcher m = BORSA_SYMBOL.matcher(symbol);
        return m.matches() ? m.group(1) : null;
    }

    private String request(String path) {
        return throttle.run(() -> {
            HttpResponse<String> res = http.raw(client, ORIGIN + path, Map.of());
            if (res.statusCode() / 100 != 2) throw new MarketSourceException("Borsa HTTP " + res.statusCode());
            return res.body();
        });
    }

    private static List<String> cells(String row) {
        List<String> out = new ArrayList<>();
        Matcher m = CELL.matcher(row);
        while (m.find()) out.add(Html.text(m.group(1)));
        return out;
    }

    static Quote parseFundPage(String html, String symbol, String url) {
        List<List<String>> rows = new ArrayList<>();
        Matcher rm = ROW.matcher(html);
        while (rm.find()) rows.add(cells(rm.group(1)));
        String isin = rows.stream().filter(r -> !r.isEmpty() && r.get(0).equalsIgnoreCase("isin") && r.size() > 1)
                .map(r -> r.get(1)).findFirst().orElse(null);
        if (isin == null || !Isin.isIsin(isin) || (Isin.isIsin(symbol) && !isin.equals(symbol))) return null;
        int header = -1;
        for (int i = 0; i < rows.size(); i++) {
            if (String.join("|", rows.get(i)).equals("Ultima|Precedente|Valuta|Data|Variazione")) {
                header = i;
                break;
            }
        }
        if (header < 0 || header + 1 >= rows.size()) return null;
        List<String> row = rows.get(header + 1);
        if (row.size() != 5) return null;
        double price = Html.decimal(row.get(0));
        double previous = Html.decimal(row.get(1));
        String currency = row.get(2);
        Matcher d = DATE.matcher(row.get(3));
        if (!d.matches() || !CURRENCY.matcher(currency).matches() || !Double.isFinite(price) || price <= 0) return null;
        String asOf = (d.group(3).length() == 2 ? "20" : "") + d.group(3) + "-" + d.group(2) + "-" + d.group(1);
        if (!validPastDate(asOf)) return null;
        Matcher h1 = H1.matcher(html);
        String name = h1.find() ? Html.text(h1.group(1)) : "";
        if (name.isEmpty()) return null;
        boolean prevOk = Double.isFinite(previous) && previous > 0;
        return new Quote(symbol, name, currency, price, prevOk ? price / previous - 1 : null, prevOk ? previous : null,
                null, null, "MUTUALFUND", SOURCE, null, YahooProvider.ISO_MS.format(Instant.now()), SOURCE, url, asOf,
                null, isin, false, false);
    }

    /** Fecha AAAA-MM-DD que existe y no es futura. */
    static boolean validPastDate(String iso) {
        try {
            return !LocalDate.parse(iso).isAfter(LocalDate.now(ZoneOffset.UTC));
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    private Quote quote(String symbol) {
        String code = fundCode(symbol);
        if (code == null) return null;
        Cached cached = cache.get(symbol);
        if (cached != null && cached.expires() > System.currentTimeMillis()) return cached.value();
        String path = "/borsa/fondi/dettaglio/" + code + ".html?lang=it";
        Quote value = parseFundPage(request(path), symbol, ORIGIN + path);
        if (value == null) throw new MarketSourceException("Ficha de fondo inválida: " + symbol);
        cache.put(symbol, new Cached(value, System.currentTimeMillis() + HOUR_MS));
        return value;
    }

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        List<Quote> results = new ArrayList<>();
        RuntimeException failure = null;
        for (String symbol : symbols) {
            try {
                Quote q = quote(symbol.toUpperCase(Locale.ROOT));
                if (q != null) results.add(q);
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
        String symbol = query.trim().toUpperCase(Locale.ROOT);
        if (fundCode(symbol) != null) {
            Quote q = quote(symbol);
            return q == null ? List.of() : List.of(new SymbolSearchResult(symbol, q.name() + " · " + q.isin(), SOURCE, "MUTUALFUND"));
        }
        if (Isin.isIsin(symbol) || query.length() < 3 || query.length() > 100) return List.of();
        JsonNode data = http.readTree(request("/borsa/searchengine/all/json/search.html?lang=it&q=" + MarketHttp.enc(query)));
        JsonNode quotes = data == null ? null : data.get("quotes");
        if (quotes == null || !quotes.isArray()) return List.of();
        List<SymbolSearchResult> results = new ArrayList<>();
        for (JsonNode item : quotes) {
            JsonNode s = item.get("symbol");
            JsonNode t = item.get("title");
            if (s == null || !s.isString() || !FUND_CODE.matcher(s.asString()).matches() || t == null || !t.isString()) continue;
            results.add(new SymbolSearchResult("BORSA:" + s.asString(), Html.text(t.asString()), SOURCE, "MUTUALFUND"));
        }
        return results;
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
