package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.Candle;
import com.cartera.dto.market.CompanyProfile;
import com.cartera.dto.market.DailyHistory;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.net.http.HttpClient;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.ReentrantLock;

import static java.util.Map.entry;

/**
 * Yahoo Finance por su API web (sin clave). Las cotizaciones, el consenso y la ficha piden una credencial
 * («crumb») ligada a una cookie; el gráfico y el buscador no. Si Yahoo niega la credencial, las cotizaciones salen
 * del gráfico diario.
 */
@Component
@Slf4j
public class YahooProvider implements MarketDataProvider {

    public static final String SOURCE = "Yahoo Finance";
    private static final String Q1 = "https://query1.finance.yahoo.com";
    private static final String Q2 = "https://query2.finance.yahoo.com";
    private static final String CRUMB_FAILED = "Yahoo no da la credencial de sus consultas (crumb)";
    private static final long DAY_MS = 86_400_000L;
    /** Cuánto vale una cotización sacada del gráfico (una consulta por valor: no se repite en cada refresco). */
    private static final long CHART_QUOTE_TTL_MS = 2 * 60_000L;
    /** Tras un fallo de la credencial, cuánto se tarda en volver a pedirla; se duplica en cada fallo seguido. */
    private static final long CRUMB_RETRY_MS = 10 * 60_000L;
    private static final long CRUMB_RETRY_MAX_MS = 60 * 60_000L;
    private static final int QUOTE_CHUNK = 50;
    /** Como toISOString de JavaScript: siempre con milisegundos. */
    public static final DateTimeFormatter ISO_MS =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter MINUTE_UTC =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm'Z'").withZone(ZoneOffset.UTC);

    /** Sectores de Yahoo en español. */
    private static final Map<String, String> SECTORS = Map.ofEntries(
            entry("Technology", "Tecnología"), entry("Financial Services", "Financiero"), entry("Healthcare", "Salud"),
            entry("Consumer Cyclical", "Consumo cíclico"), entry("Consumer Defensive", "Consumo básico"),
            entry("Industrials", "Industria"), entry("Energy", "Energía"), entry("Utilities", "Servicios públicos"),
            entry("Basic Materials", "Materiales"), entry("Real Estate", "Inmobiliario"),
            entry("Communication Services", "Telecomunicaciones"));

    /**
     * Valores en los que Yahoo se aparta de la clasificación habitual (GICS) o no da sector. Cellnex figura como
     * «Real Estate» por sus torres, pero su negocio es de telecomunicaciones. Lo escrito a mano en la ficha manda.
     */
    public static final Map<String, String> SECTOR_OVERRIDES = Map.of(
            "CLNX.MC", "Telecomunicaciones", "FDR.MC", "Industria", "VID.MC", "Materiales", "VIS.MC", "Consumo básico",
            "GRF.MC", "Salud", "GRF-P.MC", "Salud", "UBER", "Industria");

    private record Spec(int days, String interval) {
    }

    private static final Map<HistoryRange, Spec> RANGES = Map.of(
            HistoryRange.M1, new Spec(31, "1d"), HistoryRange.M3, new Spec(92, "1d"),
            HistoryRange.M6, new Spec(183, "1d"), HistoryRange.Y1, new Spec(366, "1d"),
            HistoryRange.Y5, new Spec(5 * 366, "1wk"));

    /** Yahoo guarda 7 días de 1 minuto, 60 de 5 a 30 minutos y dos años de 1 hora; no tiene 4 horas. */
    private static final Map<IntradayInterval, Spec> INTRADAY = Map.of(
            IntradayInterval.M1, new Spec(7, "1m"), IntradayInterval.M5, new Spec(30, "5m"),
            IntradayInterval.M15, new Spec(59, "15m"), IntradayInterval.M30, new Spec(59, "30m"),
            IntradayInterval.H1, new Spec(365, "60m"));

    private record Cached(Quote value, long expires) {
    }

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.newClient(true);
    private final Map<String, Cached> chartCache = Collections.synchronizedMap(new LinkedHashMap<>());
    private volatile String crumb;
    /** ReentrantLock y no synchronized: en Java 21 un hilo virtual que espera la red dentro de synchronized bloquea su hilo real. */
    private final ReentrantLock crumbLock = new ReentrantLock();
    private volatile long quoteBlockedUntil;
    private volatile long crumbRetryMs = CRUMB_RETRY_MS;
    private volatile SourceError quoteError;
    private volatile SourceError chartError;

    public YahooProvider(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "yahoo";
    }

    // ---------------------------------------------------------------- credencial

    /** La credencial no vale o Yahoo no la da. */
    static class CrumbException extends MarketSourceException {
        CrumbException(String message, Throwable cause) {
            super("crumb: " + message, cause);
        }
    }

    private String crumb(boolean refresh) {
        crumbLock.lock();
        try {
            return crumbLocked(refresh);
        } finally {
            crumbLock.unlock();
        }
    }

    private String crumbLocked(boolean refresh) {
        if (crumb != null && !refresh) return crumb;
        try {
            try {
                http.getText(client, "https://fc.yahoo.com", Map.of("Accept", "text/html"));
            } catch (MarketSourceException ignored) {
                // fc.yahoo.com responde 404 pero deja la cookie, que es lo que se busca
            }
            String value = http.getText(client, Q2 + "/v1/test/getcrumb", Map.of("Accept", "text/plain")).trim();
            if (value.isEmpty() || value.contains("<") || value.length() > 40 || value.toLowerCase(Locale.ROOT).contains("too many")) {
                throw new CrumbException("respuesta vacía", null);
            }
            crumb = value;
            return value;
        } catch (CrumbException e) {
            throw e;
        } catch (MarketSourceException e) {
            throw new CrumbException(e.getMessage(), e);
        }
    }

    /** GET con la credencial; si Yahoo la rechaza (401), se pide otra una vez. */
    private JsonNode getWithCrumb(String urlWithoutCrumb) {
        String sep = urlWithoutCrumb.contains("?") ? "&" : "?";
        try {
            return http.getJson(client, urlWithoutCrumb + sep + "crumb=" + MarketHttp.enc(crumb(false)), Map.of());
        } catch (CrumbException e) {
            throw e;
        } catch (MarketSourceException e) {
            if (!e.getMessage().startsWith("HTTP 401") && !e.getMessage().startsWith("HTTP 403")) throw e;
        }
        try {
            return http.getJson(client, urlWithoutCrumb + sep + "crumb=" + MarketHttp.enc(crumb(true)), Map.of());
        } catch (CrumbException e) {
            throw e;
        } catch (MarketSourceException e) {
            if (e.getMessage().startsWith("HTTP 401") || e.getMessage().startsWith("HTTP 403")) {
                throw new CrumbException("rechazada", e);
            }
            throw e;
        }
    }

    /**
     * Consultas que piden la credencial: consenso y ficha. Si Yahoo la niega no se insiste hasta el siguiente
     * reintento, y el error que sale no pausa la fuente: el gráfico y el buscador siguen funcionando.
     */
    private JsonNode withCrumb(String url) {
        if (System.currentTimeMillis() < quoteBlockedUntil) throw new MarketSourceException(CRUMB_FAILED);
        try {
            JsonNode res = getWithCrumb(url);
            crumbRetryMs = CRUMB_RETRY_MS;
            return res;
        } catch (CrumbException e) {
            blockCrumb(e);
            throw new MarketSourceException(CRUMB_FAILED, e);
        }
    }

    private void blockCrumb(Throwable error) {
        quoteError = new SourceError(YahooProvider.ISO_MS.format(Instant.now()), MarketSourceException.summary(error));
        quoteBlockedUntil = System.currentTimeMillis() + crumbRetryMs;
        crumbRetryMs = Math.min(crumbRetryMs * 2, CRUMB_RETRY_MAX_MS);
    }

    // ---------------------------------------------------------------- gráfico

    private JsonNode chart(String symbol, long period1Sec, String interval, boolean splits) {
        String url = Q1 + "/v8/finance/chart/" + MarketHttp.enc(symbol) + "?period1=" + period1Sec
                + "&period2=" + Instant.now().getEpochSecond() + "&interval=" + interval
                + (splits ? "&events=split" : "") + "&includePrePost=false";
        JsonNode res = http.getJson(client, url, Map.of());
        JsonNode result = res.path("chart").path("result").path(0);
        if (result.isMissingNode() || result.isNull()) {
            String desc = res.path("chart").path("error").path("description").asString("sin datos");
            throw new MarketSourceException("Yahoo: " + desc + " (" + symbol + ")");
        }
        return result;
    }

    private static long epoch(LocalDate d) {
        return d.atStartOfDay(ZoneOffset.UTC).toEpochSecond();
    }

    /** Barras del gráfico: instante (ms) y valores, saltando las vacías. */
    record Bar(long at, Double o, Double h, Double l, Double c, Double v) {
    }

    static List<Bar> bars(JsonNode chart) {
        JsonNode ts = chart.path("timestamp");
        JsonNode q = chart.path("indicators").path("quote").path(0);
        List<Bar> out = new ArrayList<>();
        for (int i = 0; i < ts.size(); i++) {
            out.add(new Bar(ts.get(i).asLong() * 1000, num(q.path("open").path(i)), num(q.path("high").path(i)),
                    num(q.path("low").path(i)), num(q.path("close").path(i)), num(q.path("volume").path(i))));
        }
        return out;
    }

    private static ZoneId zone(JsonNode chart) {
        try {
            return ZoneId.of(chart.path("meta").path("exchangeTimezoneName").asString("UTC"));
        } catch (RuntimeException e) {
            return ZoneOffset.UTC;
        }
    }

    /** Cierres diarios en la fecha de la bolsa; los anteriores a un split se pasan a la escala de hoy. */
    static DailyHistory dailyHistoryFromChart(JsonNode chart) {
        ZoneId zone = zone(chart);
        List<double[]> ratios = new ArrayList<>();
        for (JsonNode s : chart.path("events").path("splits")) {
            double num = s.path("numerator").asDouble(0);
            double den = s.path("denominator").asDouble(0);
            if (num > 0 && den > 0) ratios.add(new double[]{s.path("date").asLong() * 1000d, den / num});
        }
        TreeMap<String, Double> byDay = new TreeMap<>();
        for (Bar b : bars(chart)) {
            if (b.c() == null || b.c() <= 0) continue;
            double c = b.c();
            for (double[] r : ratios) if (b.at() < r[0]) c *= r[1];
            byDay.put(Instant.ofEpochMilli(b.at()).atZone(zone).toLocalDate().toString(), c);
        }
        List<PricePoint> points = byDay.entrySet().stream().map(e -> new PricePoint(e.getKey(), e.getValue())).toList();
        return new DailyHistory(str(chart.path("meta").path("currency")), points);
    }

    static List<Candle> candlesFromChart(JsonNode chart) {
        ZoneId zone = zone(chart);
        TreeMap<String, Candle> byDay = new TreeMap<>();
        for (Bar b : bars(chart)) {
            if (b.c() == null || b.c() <= 0) continue;
            String t = Instant.ofEpochMilli(b.at()).atZone(zone).toLocalDate().toString();
            byDay.put(t, candle(t, b));
        }
        return new ArrayList<>(byDay.values());
    }

    static List<Candle> intradayFromChart(JsonNode chart) {
        TreeMap<String, Candle> byTime = new TreeMap<>();
        for (Bar b : bars(chart)) {
            if (b.c() == null || b.c() <= 0) continue;
            String t = MINUTE_UTC.format(Instant.ofEpochMilli(b.at()));
            byTime.put(t, candle(t, b));
        }
        return new ArrayList<>(byTime.values());
    }

    private static Candle candle(String t, Bar b) {
        double c = clean(b.c());
        double o = b.o() != null ? clean(b.o()) : c;
        double h = Math.max(b.h() != null ? clean(b.h()) : c, Math.max(o, c));
        double l = Math.min(b.l() != null ? clean(b.l()) : c, Math.min(o, c));
        return new Candle(t, o, h, l, c, b.v() != null && b.v() >= 0 ? b.v() : null);
    }

    @Override
    public DailyHistory getDailyHistory(String symbol, LocalDate from) {
        return dailyHistoryFromChart(chart(symbol, epoch(from), "1d", true));
    }

    @Override
    public List<Candle> getCandles(String symbol, LocalDate from) {
        return candlesFromChart(chart(symbol, epoch(from), "1d", false));
    }

    @Override
    public List<Candle> getIntradayCandles(String symbol, IntradayInterval interval) {
        Spec spec = INTRADAY.get(interval);
        if (spec == null) return List.of();
        long from = Instant.now().minus(spec.days(), ChronoUnit.DAYS).getEpochSecond();
        return intradayFromChart(chart(symbol, from, spec.interval(), false));
    }

    @Override
    public List<PricePoint> getHistory(String symbol, HistoryRange range) {
        Spec spec = RANGES.get(range);
        long from = Instant.now().minus(spec.days(), ChronoUnit.DAYS).getEpochSecond();
        return bars(chart(symbol, from, spec.interval(), false)).stream()
                .filter(b -> b.c() != null)
                .map(b -> new PricePoint(ISO_MS.format(Instant.ofEpochMilli(b.at())), b.c()))
                .toList();
    }

    /**
     * Cotización a partir del gráfico diario: el plan B cuando Yahoo niega la credencial. La última barra es la
     * sesión del precio actual, así que el cierre anterior es la barra de antes.
     */
    static Quote quoteFromChart(String symbol, JsonNode chart, Instant now) {
        JsonNode meta = chart.path("meta");
        Double price = num(meta.path("regularMarketPrice"));
        if (price == null) return null;
        List<Bar> bars = bars(chart).stream().filter(b -> b.c() != null && b.c() > 0).toList();
        long at = meta.path("regularMarketTime").isNumber() ? meta.path("regularMarketTime").asLong() * 1000 : now.toEpochMilli();
        Bar last = bars.isEmpty() ? null : bars.getLast();
        boolean sameSession = last != null && at - last.at() < DAY_MS;
        Double previousClose = sameSession ? (bars.size() >= 2 ? bars.get(bars.size() - 2).c() : null)
                : last != null ? last.c() : null;
        String name = str(meta.path("longName"));
        if (name == null) name = str(meta.path("shortName"));
        String exchange = str(meta.path("fullExchangeName"));
        if (exchange == null) exchange = str(meta.path("exchangeName"));
        return new Quote(symbol, name, str(meta.path("currency")), price,
                previousClose != null && previousClose != 0 ? price / previousClose - 1 : null, previousClose,
                num(meta.path("fiftyTwoWeekLow")), num(meta.path("fiftyTwoWeekHigh")), str(meta.path("instrumentType")),
                exchange, null, YahooProvider.ISO_MS.format(now), SOURCE, null, null, YahooProvider.ISO_MS.format(Instant.ofEpochMilli(at)), null, false, true);
    }

    // ---------------------------------------------------------------- cotizaciones

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        if (symbols.isEmpty()) return List.of();
        if (System.currentTimeMillis() < quoteBlockedUntil) return chartQuotes(symbols);
        List<Quote> out = new ArrayList<>();
        try {
            for (int i = 0; i < symbols.size(); i += QUOTE_CHUNK) {
                List<String> chunk = symbols.subList(i, Math.min(symbols.size(), i + QUOTE_CHUNK));
                JsonNode res = getWithCrumb(Q1 + "/v7/finance/quote?symbols=" + MarketHttp.enc(String.join(",", chunk)));
                String now = YahooProvider.ISO_MS.format(Instant.now());
                for (JsonNode q : res.path("quoteResponse").path("result")) out.add(fromQuote(q, now));
            }
            crumbRetryMs = CRUMB_RETRY_MS;
            return out;
        } catch (MarketSourceException e) {
            quoteError = new SourceError(YahooProvider.ISO_MS.format(Instant.now()), MarketSourceException.summary(e));
            List<Quote> quotes = chartQuotes(symbols);
            // Sin credencial y sin nada en el gráfico (símbolos que Yahoo no conoce): no es motivo para pausar la fuente.
            if (quotes.isEmpty() && !(e instanceof CrumbException)) throw e;
            blockCrumb(e);
            log.warn("Yahoo no da cotizaciones ({}): se usan las del gráfico", e.getMessage());
            return quotes;
        }
    }

    private static Quote fromQuote(JsonNode q, String now) {
        String name = str(q.path("longName"));
        if (name == null) name = str(q.path("shortName"));
        String exchange = str(q.path("fullExchangeName"));
        if (exchange == null) exchange = str(q.path("exchange"));
        Double pct = num(q.path("regularMarketChangePercent"));
        JsonNode time = q.path("regularMarketTime");
        return new Quote(q.path("symbol").asString(), name, str(q.path("currency")), num(q.path("regularMarketPrice")),
                pct != null ? pct / 100 : null, num(q.path("regularMarketPreviousClose")),
                num(q.path("fiftyTwoWeekLow")), num(q.path("fiftyTwoWeekHigh")), str(q.path("quoteType")), exchange,
                str(q.path("marketState")), now, SOURCE, null, null,
                time.isNumber() ? YahooProvider.ISO_MS.format(Instant.ofEpochSecond(time.asLong())) : null, null, false, false);
    }

    /** Cotizaciones por la vía del gráfico, de cuatro en cuatro. Si no sale ninguna y hubo errores, falla. */
    private List<Quote> chartQuotes(List<String> symbols) {
        List<Quote> out = Collections.synchronizedList(new ArrayList<>());
        ConcurrentLinkedQueue<String> pending = new ConcurrentLinkedQueue<>(symbols);
        AtomicReference<RuntimeException> failure = new AtomicReference<>();
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int w = 0; w < Math.min(4, symbols.size()); w++) {
                pool.submit(() -> {
                    for (String symbol = pending.poll(); symbol != null; symbol = pending.poll()) {
                        Cached hit = chartCache.get(symbol);
                        if (hit != null && hit.expires() > System.currentTimeMillis()) {
                            out.add(hit.value());
                            continue;
                        }
                        try {
                            long from = Instant.now().minus(10, ChronoUnit.DAYS).getEpochSecond();
                            Quote value = quoteFromChart(symbol, chart(symbol, from, "1d", false), Instant.now());
                            if (value == null) continue;
                            synchronized (chartCache) {
                                if (chartCache.size() >= 1024) chartCache.remove(chartCache.keySet().iterator().next());
                                chartCache.put(symbol, new Cached(value, System.currentTimeMillis() + CHART_QUOTE_TTL_MS));
                            }
                            out.add(value);
                        } catch (RuntimeException e) {
                            failure.compareAndSet(null, e);
                            chartError = new SourceError(YahooProvider.ISO_MS.format(Instant.now()), MarketSourceException.summary(e));
                        }
                    }
                });
            }
        }
        if (out.isEmpty() && failure.get() != null) throw failure.get();
        return new ArrayList<>(out);
    }

    // ---------------------------------------------------------------- resumen (consenso, ficha)

    private JsonNode quoteSummary(String symbol, String modules) {
        JsonNode res = withCrumb(Q2 + "/v10/finance/quoteSummary/" + MarketHttp.enc(symbol) + "?modules=" + modules);
        return res.path("quoteSummary").path("result").path(0);
    }

    @Override
    public AnalystTargets getTargets(String symbol) {
        JsonNode res = quoteSummary(symbol, "financialData,calendarEvents,summaryDetail");
        JsonNode f = res.path("financialData");
        JsonNode d = res.path("summaryDetail");
        JsonNode cal = res.path("calendarEvents");
        Double analysts = raw(f.path("numberOfAnalystOpinions"));
        AnalystTargets out = new AnalystTargets(
                raw(f.path("targetMeanPrice")), raw(f.path("targetMedianPrice")), raw(f.path("targetHighPrice")),
                raw(f.path("targetLowPrice")), analysts == null ? null : analysts.intValue(),
                str(f.path("recommendationKey")), raw(f.path("recommendationMean")),
                date(cal.path("earnings").path("earningsDate").path(0)), date(cal.path("exDividendDate")),
                raw(d.path("dividendYield")), raw(d.path("trailingPE")), raw(d.path("marketCap")), null);
        boolean any = out.mean() != null || out.median() != null || out.high() != null || out.low() != null
                || out.analysts() != null || out.recommendation() != null || out.recommendationMean() != null
                || out.nextEarnings() != null || out.exDividend() != null || out.dividendYield() != null
                || out.trailingPE() != null || out.marketCap() != null;
        return any ? out : null;
    }

    @Override
    public CompanyProfile getProfile(String symbol) {
        JsonNode res = quoteSummary(symbol, "assetProfile,price");
        String raw = str(res.path("assetProfile").path("sector"));
        String sector = SECTOR_OVERRIDES.getOrDefault(symbol.toUpperCase(Locale.ROOT),
                raw == null ? null : SECTORS.getOrDefault(raw, raw));
        String name = str(res.path("price").path("longName"));
        if (name == null) name = str(res.path("price").path("shortName"));
        return sector != null || name != null ? new CompanyProfile(name, sector) : null;
    }

    /** Mayores posiciones de un fondo o ETF (módulo topHoldings) tal como las da Yahoo; null si no tiene. */
    public JsonNode topHoldings(String symbol) {
        try {
            JsonNode res = quoteSummary(symbol, "topHoldings").path("topHoldings");
            return res.isMissingNode() || res.isNull() ? null : res;
        } catch (MarketSourceException e) {
            // Una acción o un símbolo que Yahoo no conoce: no tiene composición, no es un fallo de la fuente.
            if (MarketSourceException.text(e).matches("(?is).*(no fundamentals data|not found|404).*")) return null;
            throw e;
        }
    }

    // ---------------------------------------------------------------- buscador

    @Override
    public List<SymbolSearchResult> search(String query) {
        JsonNode res = http.getJson(client, Q2 + "/v1/finance/search?q=" + MarketHttp.enc(query)
                + "&quotesCount=12&newsCount=0&enableFuzzyQuery=false", Map.of());
        List<SymbolSearchResult> out = new ArrayList<>();
        for (JsonNode q : res.path("quotes")) {
            if (!q.path("symbol").isString() || q.path("isYahooFinance").isBoolean() && !q.path("isYahooFinance").asBoolean()) continue;
            String symbol = q.path("symbol").asString();
            String name = str(q.path("longname"));
            if (name == null) name = str(q.path("shortname"));
            String exchange = str(q.path("exchDisp"));
            if (exchange == null) exchange = str(q.path("exchange"));
            String type = str(q.path("typeDisp"));
            if (type == null) type = str(q.path("quoteType"));
            out.add(new SymbolSearchResult(symbol, name == null ? symbol : name, exchange, type));
        }
        return out;
    }

    @Override
    public Map<String, Object> diagnostics() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("quotesByChartUntil", quoteBlockedUntil > System.currentTimeMillis()
                ? YahooProvider.ISO_MS.format(Instant.ofEpochMilli(quoteBlockedUntil)) : null);
        out.put("quoteError", quoteError);
        out.put("chartError", chartError);
        return out;
    }

    // ---------------------------------------------------------------- utilidades

    /**
     * Los precios de las velas de Yahoo son floats de 32 bits (22.790000915527344 por 22.79): se quedan en las
     * 7 cifras significativas que guardan, o el gráfico enseña seis decimales de ruido.
     */
    static double clean(double v) {
        return new BigDecimal(v).round(FLOAT_DIGITS).doubleValue();
    }

    private static final MathContext FLOAT_DIGITS = new MathContext(7, RoundingMode.HALF_EVEN);

    static Double num(JsonNode v) {
        return v != null && v.isNumber() && Double.isFinite(v.asDouble()) ? v.asDouble() : null;
    }

    static String str(JsonNode v) {
        return v != null && v.isString() && !v.asString().isBlank() ? v.asString() : null;
    }

    /** Valor de un campo del resumen: viene como {raw, fmt} o como número suelto. */
    private static Double raw(JsonNode v) {
        return v.isObject() ? num(v.path("raw")) : num(v);
    }

    private static String date(JsonNode v) {
        Double sec = raw(v);
        return sec == null ? null : Instant.ofEpochSecond(sec.longValue()).atZone(ZoneOffset.UTC).toLocalDate().toString();
    }
}
