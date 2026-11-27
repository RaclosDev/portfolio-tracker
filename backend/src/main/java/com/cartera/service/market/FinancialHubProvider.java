package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.Candle;
import com.cartera.dto.market.DailyHistory;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import com.cartera.repository.MarketCacheRepository;
import com.cartera.util.Isin;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.cartera.util.MarketSymbols;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Precios de la API pública de Financial Hub (api.financial-hub.es, sin clave): acciones y ETF en directo por su
 * cotización en cada bolsa y fondos por su valor liquidativo. No tiene símbolos propios: traduce los de la app
 * (Yahoo «CHIP.PA», FT «FT:SEC0:GER:EUR», ISIN de fondos) a sus identificadores y, si no hay uno solo seguro, no
 * contesta y el precio sale de la siguiente fuente.
 */
@Slf4j
@Component
public class FinancialHubProvider implements MarketDataProvider {

    public static final String SOURCE = "Financial Hub";
    private static final String API = "https://api.financial-hub.es";
    private static final Map<String, String> HEADERS =
            Map.of("Accept", "application/json", "User-Agent", "watchlist (uso personal)");
    private static final long DAY_MS = 86_400_000L;
    private static final long REF_TTL_MS = 7 * DAY_MS;
    private static final long NO_REF_TTL_MS = DAY_MS;
    private static final long RETRY_LOGO_MS = DAY_MS / 24;
    private static final long RANGE_TTL_MS = 12 * 3_600_000L;
    private static final int BATCH = 100;
    static final int MAX_REFS = 5_000;
    static final int MAX_LOGOS = 5_000;
    /** Cuánto se espera para reintentar el rango de 52 semanas tras un fallo (no en cada lectura de precios). */
    private static final long RANGE_RETRY_MS = 10 * 60_000L;
    /** Búsquedas de logo a la API por minuto, sumando a todos los visitantes. */
    static final int MAX_LOGO_LOOKUPS_PER_MINUTE = 60;
    private static final int RESOLVE_PARALLEL = 4;

    /** Historia que se pide de cada intervalo intradía: unas 2.000-5.000 velas. */
    private static final Map<IntradayInterval, String> INTRADAY_RANGE = Map.of(
            IntradayInterval.M1, "1w", IntradayInterval.M5, "1m", IntradayInterval.M15, "3m",
            IntradayInterval.M30, "6m", IntradayInterval.H1, "1y", IntradayInterval.H4, "5y");

    /**
     * Bolsas (MIC) de cada sufijo de Yahoo y mercado de FT. Londres queda fuera a propósito: allí se cotiza en
     * peniques y la API no dice en qué unidad viene el precio.
     */
    private static final Map<String, List<String>> MIC = Map.ofEntries(
            Map.entry("DE", List.of("XETR")), Map.entry("GER", List.of("XETR")),
            Map.entry("AS", List.of("XAMS")), Map.entry("AEX", List.of("XAMS")),
            Map.entry("MI", List.of("XMIL")), Map.entry("MIL", List.of("XMIL")),
            Map.entry("PA", List.of("XPAR")), Map.entry("PAR", List.of("XPAR")),
            Map.entry("SW", List.of("XSWX")), Map.entry("SWX", List.of("XSWX")),
            Map.entry("MC", List.of("XMAD")), Map.entry("MCE", List.of("XMAD")),
            Map.entry("BR", List.of("XBRU")), Map.entry("BRU", List.of("XBRU")),
            Map.entry("LS", List.of("XLIS")), Map.entry("LIS", List.of("XLIS")),
            Map.entry("VI", List.of("XWBO")), Map.entry("VIE", List.of("XWBO")),
            Map.entry("CO", List.of("XCSE")), Map.entry("ST", List.of("XSTO")),
            Map.entry("HE", List.of("XHEL")), Map.entry("OL", List.of("XOSL")),
            Map.entry("TO", List.of("XTSE")), Map.entry("TOR", List.of("XTSE")),
            Map.entry("NYQ", List.of("XNYS")), Map.entry("NSQ", List.of("XNAS")),
            Map.entry("NMQ", List.of("XNAS")), Map.entry("PCQ", List.of("ARCX")));
    /** Sin sufijo, Yahoo se refiere a las bolsas de EE. UU. */
    private static final List<String> US = List.of("XNAS", "XNYS", "ARCX", "BATS", "XASE");
    /** Prefijos con ISIN de otras fuentes (XETRA:IE00B4L5Y983). */
    private static final Map<String, List<String>> PREFIX_MIC = Map.of("XETRA", List.of("XETR"));
    private static final Map<String, String> VENUES = Map.ofEntries(
            Map.entry("XETR", "Xetra"), Map.entry("XAMS", "Ámsterdam"), Map.entry("XMIL", "Milán"),
            Map.entry("XPAR", "París"), Map.entry("XSWX", "Suiza"), Map.entry("XMAD", "Madrid"),
            Map.entry("XBRU", "Bruselas"), Map.entry("XLIS", "Lisboa"), Map.entry("XWBO", "Viena"),
            Map.entry("XCSE", "Copenhague"), Map.entry("XSTO", "Estocolmo"), Map.entry("XHEL", "Helsinki"),
            Map.entry("XOSL", "Oslo"), Map.entry("XTSE", "Toronto"), Map.entry("XNAS", "Nasdaq"),
            Map.entry("XNYS", "NYSE"), Map.entry("ARCX", "NYSE Arca"), Map.entry("BATS", "Cboe"),
            Map.entry("XASE", "NYSE American"));
    private static final Map<String, String> TYPES = Map.of("stock", "EQUITY", "etf", "ETF", "fund", "MUTUALFUND");
    private static final Map<String, String> PHASES =
            Map.of("regular", "REGULAR", "pre", "PRE", "post", "POST", "closed", "CLOSED");
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern MINUTE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}Z$");
    private static final Pattern SUFFIX = Pattern.compile("\\.([A-Z]+)$");

    /** A qué serie de Financial Hub corresponde un símbolo de la app. {@code kind}: listing o fund_class. */
    public record FhRef(String kind, long id, String currency, String name, String isin, String quoteType,
                        String exchange) {
        boolean fund() {
            return kind.equals("fund_class");
        }
    }

    /** Qué buscar para un símbolo: ISIN de fondo, ISIN en una bolsa o ticker en unas bolsas (con divisa si la dice). */
    record Wanted(String by, String isin, String root, List<String> mics, String currency) {
    }

    private record Cached<T>(T value, long at) {
    }

    private static <T> Map<String, T> bounded(int max) {
        return Caffeine.newBuilder().maximumSize(max).<String, T>build().asMap();
    }

    private record Range(Double low, Double high) {
    }

    private record Child(JsonNode hit, JsonNode node) {
    }

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.newClient(false);
    // Con tope de entradas: las claves salen de lo que escribe el usuario (símbolos, ISIN) y no pueden crecer sin límite.
    private final Map<String, Cached<FhRef>> refs = bounded(MAX_REFS);
    private final Map<String, Cached<Range>> ranges = bounded(MAX_REFS);
    private final Map<String, Cached<String>> logos = bounded(MAX_LOGOS);
    /** Búsquedas de logo que van a la API (no salen de la caché) en el minuto en curso: tope para todos los visitantes. */
    private final AtomicInteger logoLookups = new AtomicInteger();
    private volatile long logoWindowStart;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    private final MarketCacheRepository store;

    public FinancialHubProvider(MarketHttp http, MarketCacheRepository store) {
        this.http = http;
        this.store = store;
    }

    /** Fila de {@code market_cache} con el logo de cada ISIN: sobrevive a los reinicios (cada despliegue vaciaba la caché). */
    private static final String LOGO_KIND = "fh-logo";

    @Override
    public String id() {
        return "financialhub";
    }

    // ---- utilidades de JSON ----

    private static String str(JsonNode v) {
        if (v == null || !v.isString()) return null;
        String s = v.asString().trim();
        return s.isEmpty() ? null : s;
    }

    private static Double num(JsonNode v) {
        return v != null && v.isNumber() && Double.isFinite(v.asDouble()) ? v.asDouble() : null;
    }

    private static Long id(JsonNode v) {
        if (v == null) return null;
        if (v.isIntegralNumber() && v.asLong() > 0) return v.asLong();
        if (v.isString() && v.asString().matches("\\d+")) return Long.parseLong(v.asString());
        return null;
    }

    private static boolean currencyOk(String c) {
        return c != null && CURRENCY.matcher(c).matches();
    }

    private static String upper(String s) {
        return s == null ? null : s.toUpperCase(Locale.ROOT);
    }

    private JsonNode json(String path) {
        try {
            return http.getJson(client, API + path, HEADERS);
        } catch (MarketSourceException e) {
            if (e.getMessage() != null && e.getMessage().startsWith("HTTP 404")) return null;
            throw e;
        }
    }

    private List<JsonNode> data(JsonNode body) {
        List<JsonNode> out = new ArrayList<>();
        JsonNode d = body == null ? null : body.get("data");
        if (d != null && d.isArray()) d.forEach(out::add);
        return out;
    }

    private List<JsonNode> lookup(String q, String types) {
        return data(json("/search?q=" + MarketHttp.enc(q) + "&identifierLookup=true"
                + (types != null ? "&types=" + types : "")));
    }

    // ---- resolución de símbolos ----

    static Wanted wantedFor(String symbol) {
        String s = symbol.trim().toUpperCase(Locale.ROOT);
        if (Isin.isIsin(s)) return new Wanted("fund", s, null, null, null);
        String isin = MarketSymbols.isinInSymbol(s);
        String[] parts = s.split(":", -1);
        if (isin != null) {
            if (s.startsWith("FT:")) return new Wanted("fund", isin, null, null, parts.length > 2 ? parts[2] : null);
            List<String> mics = PREFIX_MIC.get(parts[0]);
            return mics != null ? new Wanted("isin", isin, null, mics, null) : null;
        }
        if (s.contains(":") && !s.startsWith("FT:")) return null;
        MarketSymbols.Ticker t = MarketSymbols.tickerOf(s);
        if (t == null) return null;
        String market;
        if (s.startsWith("FT:")) {
            market = parts.length > 2 ? parts[2] : null;
        } else {
            Matcher m = SUFFIX.matcher(s);
            market = m.find() ? m.group(1) : null;
        }
        List<String> mics = market != null ? MIC.get(market) : US;
        return mics != null ? new Wanted("ticker", null, t.root(), mics, t.currency()) : null;
    }

    /** La serie de Financial Hub de un símbolo, o null si no hay una sola que encaje sin dudas. */
    public FhRef resolve(String symbol) {
        String key = symbol.trim().toUpperCase(Locale.ROOT);
        Cached<FhRef> cached = refs.get(key);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.at() < (cached.value() != null ? REF_TTL_MS : NO_REF_TTL_MS)) {
            return cached.value();
        }
        Wanted want = wantedFor(key);
        FhRef ref = want != null ? find(want) : null;
        refs.put(key, new Cached<>(ref, now));
        return ref;
    }

    /**
     * Dirección del logo de un producto en Financial Hub (SVG, versionada con su hash), o null si no tiene.
     * Se busca por ISIN y se guarda una semana; los que no tienen logo, un día. Si la búsqueda falla
     * (límite de la API, red), no se guarda y se reintenta en la siguiente petición.
     */
    public String logoUrl(String isin) {
        String key = isin.trim().toUpperCase(Locale.ROOT);
        Cached<String> cached = logos.get(key);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.at() < (cached.value() != null ? REF_TTL_MS : NO_REF_TTL_MS)) {
            return cached.value();
        }
        MarketCacheRepository.Row row = store.find(LOGO_KIND, key);
        String saved = row != null ? str(row.data()) : null;
        if (row != null && now - row.fetchedAtMillis() < (saved != null ? REF_TTL_MS : NO_REF_TTL_MS)) {
            logos.put(key, new Cached<>(saved, row.fetchedAtMillis()));
            return saved;
        }
        if (!takeLogoLookup(now)) {
            // Demasiadas búsquedas nuevas a la vez (alguien recorre ISIN a ciegas): el logo que se tenía sirve.
            if (saved != null) return saved;
            throw new MarketSourceException("Demasiadas búsquedas de logos; vuelve a intentarlo en un minuto.");
        }
        String url;
        try {
            String path = logoPath(lookup(key, null), key);
            url = path != null ? API + path : null;
        } catch (RuntimeException e) {
            // Límite de la API o red: el logo que ya teníamos sigue valiendo; se vuelve a buscar en una hora.
            if (saved == null) throw e;
            logos.put(key, new Cached<>(saved, now - REF_TTL_MS + RETRY_LOGO_MS));
            return saved;
        }
        // Un logo que ya existía no se pierde porque una búsqueda no lo devuelva.
        url = keepKnownLogo(url, saved);
        logos.put(key, new Cached<>(url, now));
        store.save(LOGO_KIND, key, url);
        return url;
    }

    /** Cuenta una búsqueda a la API en la ventana de un minuto; false si ya se ha gastado el cupo. */
    private boolean takeLogoLookup(long now) {
        synchronized (logoLookups) {
            if (now - logoWindowStart >= 60_000L) {
                logoWindowStart = now;
                logoLookups.set(0);
            }
            return logoLookups.incrementAndGet() <= MAX_LOGO_LOOKUPS_PER_MINUTE;
        }
    }

    static String keepKnownLogo(String found, String saved) {
        return found != null ? found : saved;
    }

    /** El logo del resultado cuyo ISIN coincide (la clase buscada o la cotización principal). */
    static String logoPath(List<JsonNode> hits, String isin) {
        for (JsonNode h : hits) {
            for (JsonNode c : new JsonNode[]{h.get("matchedChild"), h.get("primary")}) {
                if (!present(c) || !isin.equals(str(c.get("isin")))) continue;
                String path = str(c.get("logoUrl")) != null ? str(c.get("logoUrl")) : str(h.get("logoUrl"));
                return path != null && path.startsWith("/market/logos/") ? path : null;
            }
        }
        return null;
    }

    /** ISIN de un símbolo según Financial Hub (para la composición de fondos y ETF). */
    public String isinOf(String symbol) {
        FhRef ref = resolve(symbol);
        return ref != null ? ref.isin() : null;
    }

    private FhRef find(Wanted want) {
        if (want.by().equals("fund")) {
            for (JsonNode h : lookup(want.isin(), "fund")) {
                for (JsonNode c : new JsonNode[]{h.get("matchedChild"), h.get("primary")}) {
                    if (c == null || c.isNull() || !want.isin().equals(str(c.get("isin")))) continue;
                    // Solo cuenta la primera coincidencia, como en la API de la web.
                    Long classId = id(c.get("instrumentId"));
                    String currency = str(c.get("currency"));
                    if (classId == null || !currencyOk(currency)
                            || (want.currency() != null && !want.currency().equals(currency))) return null;
                    String name = str(c.get("name")) != null ? str(c.get("name")) : str(h.get("name"));
                    return new FhRef("fund_class", classId, currency, name, want.isin(), "MUTUALFUND", SOURCE);
                }
            }
            return null;
        }

        List<JsonNode> hits = lookup(want.by().equals("isin") ? want.isin() : want.root(), null).stream()
                .filter(h -> "stock".equals(str(h.get("type"))) || "etf".equals(str(h.get("type")))).toList();
        Map<Long, FhRef> candidates = new LinkedHashMap<>();
        for (JsonNode h : hits) {
            JsonNode primary = h.get("primary");
            JsonNode matched = h.get("matchedChild");
            if (!sameProduct(want, primary) && !sameProduct(want, matched)) continue;
            consider(want, candidates, h, matched, null);
            consider(want, candidates, h, primary, null);
        }
        // Si la búsqueda devuelve el producto pero en otra bolsa, se miran todas sus cotizaciones.
        if (candidates.isEmpty()) {
            for (JsonNode h : hits.subList(0, Math.min(3, hits.size()))) {
                JsonNode c = present(h.get("matchedChild")) ? h.get("matchedChild") : h.get("primary");
                Long instrumentId = c == null ? null : id(c.get("instrumentId"));
                boolean same = want.by().equals("isin")
                        ? c != null && want.isin().equals(str(c.get("isin")))
                        : (c != null && want.root().equals(upper(str(c.get("symbol"))))) || "etf".equals(str(h.get("type")));
                if (instrumentId == null || !same) continue;
                for (JsonNode l : data(json("/assets/" + instrumentId + "/listings"))) {
                    consider(want, candidates, h, l, c);
                }
            }
        }
        return candidates.size() == 1 ? candidates.values().iterator().next() : null;
    }

    private static boolean present(JsonNode n) {
        return n != null && !n.isNull() && n.isObject();
    }

    private static boolean sameProduct(Wanted want, JsonNode c) {
        if (!present(c)) return false;
        return want.by().equals("isin") ? want.isin().equals(str(c.get("isin")))
                : want.root().equals(upper(str(c.get("symbol"))));
    }

    /** {@code parent}: el producto del que salen las cotizaciones de /listings (nombre e ISIN). */
    private static void consider(Wanted want, Map<Long, FhRef> candidates, JsonNode h, JsonNode c, JsonNode parent) {
        if (!present(c)) return;
        Long listingId = id(c.get("listingId"));
        String mic = str(c.get("mic")) != null ? str(c.get("mic")) : str(c.get("exchange"));
        String currency = str(c.get("currency"));
        if (listingId == null || mic == null || !want.mics().contains(mic) || !currencyOk(currency)) return;
        if (want.by().equals("ticker") && (!want.root().equals(upper(str(c.get("symbol"))))
                || (want.currency() != null && !want.currency().equals(currency)))) return;
        JsonNode info = parent != null ? parent : c;
        String name = str(info.get("name")) != null ? str(info.get("name")) : str(h.get("name"));
        candidates.put(listingId, new FhRef("listing", listingId, currency, name, str(info.get("isin")),
                TYPES.get(str(h.get("type"))), VENUES.getOrDefault(mic, mic)));
    }

    // ---- cotizaciones ----

    private Quote toQuote(String symbol, FhRef ref, JsonNode q, Range range) {
        Double price = num(q.get("price"));
        String currency = str(q.get("currency")) != null ? str(q.get("currency")) : ref.currency();
        if (price == null || price <= 0 || !currencyOk(currency) || !currency.equals(ref.currency())) return null;
        boolean fund = ref.fund();
        String rawAsOf = str(q.get("asOf"));
        String tradingDate = str(q.get("tradingDate"));
        String asOf = tradingDate != null ? tradingDate : rawAsOf != null && rawAsOf.length() >= 10 ? rawAsOf.substring(0, 10) : null;
        String priceTime = null;
        if (!fund && rawAsOf != null) {
            try {
                priceTime = YahooProvider.ISO_MS.format(Instant.parse(rawAsOf));
            } catch (DateTimeParseException e) {
                priceTime = null;
            }
        }
        Double changePct = num(q.get("changePct"));
        String sourceUrl = ref.isin() == null ? null : "https://financial-hub.es/"
                + (fund ? "fund" : "ETF".equals(ref.quoteType()) ? "etf" : "stock") + "/" + ref.isin()
                + (fund ? "" : "?listingId=" + ref.id());
        return new Quote(symbol, ref.name(), currency, price, changePct != null ? changePct / 100 : null,
                num(q.get("previousClose")),
                range != null && range.low() != null ? Math.min(range.low(), price) : null,
                range != null && range.high() != null ? Math.max(range.high(), price) : null,
                ref.quoteType(), ref.exchange(), PHASES.get(str(q.get("marketPhase")) == null ? "" : str(q.get("marketPhase"))),
                YahooProvider.ISO_MS.format(Instant.now()), SOURCE, sourceUrl, fund ? asOf : null, priceTime,
                ref.isin(), false, false);
    }

    /**
     * Máximo y mínimo del último año (para el rango de 52 semanas), con caché de 12 h. Si falla no se vuelve a
     * intentar en cada lectura de precios (con la API caída cada intento puede tardar segundos y frena al vigilante
     * de avisos): se guarda el fallo diez minutos y mientras tanto sirve el último rango conocido, o ninguno.
     */
    private Range yearRange(FhRef ref) {
        String key = ref.kind() + ":" + ref.id();
        Cached<Range> cached = ranges.get(key);
        long now = System.currentTimeMillis();
        if (cached != null && now - cached.at() < RANGE_TTL_MS) return cached.value();
        List<PricePoint> points;
        try {
            points = series(ref, "range=1y");
        } catch (RuntimeException e) {
            Range known = cached != null ? cached.value() : null;
            ranges.put(key, new Cached<>(known, now - RANGE_TTL_MS + RANGE_RETRY_MS));
            return known;
        }
        Range range = new Range(points.stream().mapToDouble(PricePoint::c).min().stream().boxed().findFirst().orElse(null),
                points.stream().mapToDouble(PricePoint::c).max().stream().boxed().findFirst().orElse(null));
        ranges.put(key, new Cached<>(range, System.currentTimeMillis()));
        return range;
    }

    /**
     * Velas de la serie, siguiendo las páginas (los fondos solo tienen valor liquidativo: vela plana). Las diarias
     * llevan la fecha de la sesión; las intradía, la fecha y hora UTC de su inicio (YYYY-MM-DDTHH:MMZ).
     */
    private List<Candle> ohlc(FhRef ref, String query, String resolution) {
        boolean daily = resolution.equals("1d");
        List<Candle> candles = new ArrayList<>();
        String cursor = null;
        for (int page = 0; page < 10; page++) {
            JsonNode body = json("/market/series/" + ref.id() + "/history?kind=" + ref.kind() + "&resolution="
                    + resolution + "&pageSize=5000&" + query + (cursor != null ? "&cursor=" + MarketHttp.enc(cursor) : ""));
            JsonNode d = body == null ? null : body.get("data");
            if (!present(d)) break;
            if (str(d.get("currency")) != null && !str(d.get("currency")).equals(ref.currency())) return List.of();
            JsonNode points = d.get("points");
            if (points != null && points.isArray()) {
                for (JsonNode p : points) {
                    String time = str(p.get("time"));
                    String t = time == null ? null : daily ? (time.length() >= 10 ? time.substring(0, 10) : null)
                            : (time.length() >= 16 ? time.substring(0, 16) + "Z" : null);
                    Double c = num(p.get("close")) != null ? num(p.get("close")) : num(p.get("value"));
                    if (t == null || !(daily ? DATE : MINUTE).matcher(t).matches() || c == null || c <= 0) continue;
                    double o = num(p.get("open")) != null ? num(p.get("open")) : c;
                    double hi = num(p.get("high")) != null ? num(p.get("high")) : c;
                    double lo = num(p.get("low")) != null ? num(p.get("low")) : c;
                    candles.add(new Candle(t, o, Math.max(hi, Math.max(o, c)), Math.min(lo, Math.min(o, c)), c,
                            volume(p.get("volume"))));
                }
            }
            cursor = str(d.get("nextCursor"));
            if (cursor == null) break;
        }
        candles.sort(Comparator.comparing(Candle::t));
        return candles;
    }

    private List<PricePoint> series(FhRef ref, String query) {
        return ohlc(ref, query, "1d").stream().map(c -> new PricePoint(c.t(), c.c())).toList();
    }

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        Map<String, FhRef> resolved = new LinkedHashMap<>();
        // De cuatro en cuatro para no pasarse del límite de la API; un 429 corta y el resto va a las otras fuentes.
        RuntimeException limited = null;
        for (int i = 0; i < symbols.size() && limited == null; i += RESOLVE_PARALLEL) {
            List<String> batch = symbols.subList(i, Math.min(i + RESOLVE_PARALLEL, symbols.size()));
            List<Future<FhRef>> futures = batch.stream().map(s -> pool.submit(() -> resolve(s))).toList();
            for (int j = 0; j < batch.size(); j++) {
                try {
                    FhRef ref = futures.get(j).get();
                    if (ref != null) resolved.put(batch.get(j), ref);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new MarketSourceException("Consulta interrumpida a " + SOURCE, e);
                } catch (java.util.concurrent.ExecutionException e) {
                    if (limited == null) {
                        limited = e.getCause() instanceof RuntimeException r ? r : new MarketSourceException(SOURCE, e);
                    }
                }
            }
        }
        if (resolved.isEmpty() && limited != null) throw limited;

        Map<String, JsonNode> quotes = new LinkedHashMap<>();
        for (String kind : List.of("listing", "fund_class")) {
            List<Long> ids = new ArrayList<>(new LinkedHashSet<>(resolved.values().stream()
                    .filter(r -> r.kind().equals(kind)).map(FhRef::id).toList()));
            String param = kind.equals("listing") ? "listingIds" : "instrumentIds";
            for (int i = 0; i < ids.size(); i += BATCH) {
                String list = String.join(",", ids.subList(i, Math.min(i + BATCH, ids.size())).stream().map(String::valueOf).toList());
                for (JsonNode row : data(json("/market/quotes?" + param + "=" + list))) {
                    JsonNode r = row.get("ref");
                    Long key = r == null ? null : id(r.get(kind.equals("listing") ? "listingId" : "instrumentId"));
                    if (key != null && present(row.get("quote"))) quotes.put(kind + ":" + key, row.get("quote"));
                }
            }
        }
        prefetchRanges(resolved.entrySet().stream()
                .filter(e -> quotes.containsKey(e.getValue().kind() + ":" + e.getValue().id()))
                .map(Map.Entry::getValue).distinct().toList());
        List<Quote> out = new ArrayList<>();
        resolved.forEach((symbol, ref) -> {
            JsonNode q = quotes.get(ref.kind() + ":" + ref.id());
            if (q == null) return;
            Quote quote = toQuote(symbol.trim().toUpperCase(Locale.ROOT), ref, q, yearRange(ref));
            if (quote != null) out.add(quote);
        });
        return out;
    }

    /** Rellena la caché de rangos de 52 semanas que falten, de cuatro en cuatro en paralelo en vez de una a una. */
    private void prefetchRanges(List<FhRef> refs) {
        long now = System.currentTimeMillis();
        List<FhRef> missing = refs.stream().filter(r -> {
            Cached<Range> c = ranges.get(r.kind() + ":" + r.id());
            return c == null || now - c.at() >= RANGE_TTL_MS;
        }).toList();
        for (int i = 0; i < missing.size(); i += RESOLVE_PARALLEL) {
            List<Future<Range>> futures = missing.subList(i, Math.min(i + RESOLVE_PARALLEL, missing.size())).stream()
                    .map(r -> pool.submit(() -> yearRange(r))).toList();
            for (Future<Range> f : futures) {
                try {
                    f.get();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                } catch (java.util.concurrent.ExecutionException e) {
                    log.debug("Rango de 52 semanas no disponible: {}", e.getMessage());
                }
            }
        }
    }

    @Override
    public List<PricePoint> getHistory(String symbol, HistoryRange range) {
        FhRef ref = resolve(symbol);
        return ref != null ? series(ref, "range=" + range.id()) : List.of();
    }

    /**
     * Solo el valor liquidativo de los fondos: las cotizaciones de bolsa pueden venir ajustadas por splits y el
     * histórico de la cartera necesita los precios tal cual; esas siguen saliendo de las demás fuentes.
     */
    @Override
    public DailyHistory getDailyHistory(String symbol, LocalDate from) {
        FhRef ref = resolve(symbol);
        if (ref == null || !ref.fund()) return DailyHistory.EMPTY;
        String f = from.toString();
        return new DailyHistory(ref.currency(), series(ref, "from=" + f).stream().filter(p -> p.t().compareTo(f) >= 0).toList());
    }

    /** Vela de la sesión en curso a partir de la cotización en directo, o null si no trae los datos del día. */
    static Candle liveCandle(JsonNode q, String currency) {
        Double c = num(q.get("price"));
        String t = str(q.get("tradingDate"));
        JsonNode day = q.get("day");
        Double o = present(day) ? num(day.get("open")) : null;
        if (c == null || c <= 0 || o == null || o <= 0 || t == null || !DATE.matcher(t).matches()) return null;
        if (str(q.get("currency")) != null && !str(q.get("currency")).equals(currency)) return null;
        Double hi = num(day.get("high"));
        Double lo = num(day.get("low"));
        return new Candle(t, o, Math.max(hi != null ? hi : c, Math.max(o, c)), Math.min(lo != null ? lo : c, Math.min(o, c)), c,
                volume(q.get("volume")));
    }

    /** Títulos negociados, o null si no viene o no es válido. */
    static Double volume(JsonNode n) {
        Double v = num(n);
        return v != null && v >= 0 ? v : null;
    }

    /**
     * Velas diarias desde una fecha. El histórico llega hasta la última sesión cerrada; la de hoy se completa con
     * la cotización en directo (apertura, máximo y mínimo del día y último precio).
     */
    @Override
    public List<Candle> getCandles(String symbol, LocalDate from) {
        FhRef ref = resolve(symbol);
        if (ref == null) return List.of();
        String f = from.toString();
        List<Candle> candles = new ArrayList<>(ohlc(ref, "from=" + f, "1d").stream().filter(c -> c.t().compareTo(f) >= 0).toList());
        if (ref.fund()) return candles;
        JsonNode q = null;
        try {
            List<JsonNode> rows = data(json("/market/quotes?listingIds=" + ref.id()));
            q = rows.isEmpty() ? null : rows.getFirst().get("quote");
        } catch (RuntimeException e) {
            // Sin la vela de hoy.
        }
        Candle live = present(q) ? liveCandle(q, ref.currency()) : null;
        Candle last = candles.isEmpty() ? null : candles.getLast();
        if (live != null && (last == null || live.t().compareTo(last.t()) > 0)) candles.add(live);
        else if (live != null && live.t().equals(last.t())) candles.set(candles.size() - 1, live);
        return candles;
    }

    /** Velas intradía de una cotización en bolsa (los fondos no tienen), con más o menos historia según el intervalo. */
    @Override
    public List<Candle> getIntradayCandles(String symbol, IntradayInterval interval) {
        FhRef ref = resolve(symbol);
        if (ref == null || ref.fund()) return List.of();
        return ohlc(ref, "range=" + INTRADAY_RANGE.get(interval), interval.id());
    }

    @Override
    public AnalystTargets getTargets(String symbol) {
        return null;
    }

    @Override
    public List<SymbolSearchResult> search(String query) {
        return List.of();
    }

    @Override
    public Map<String, Object> diagnostics() {
        return Map.of("cachedRefs", refs.size());
    }
}
