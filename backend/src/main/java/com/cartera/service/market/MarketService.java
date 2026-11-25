package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.Candle;
import com.cartera.dto.market.CandlesResult;
import com.cartera.dto.market.CompanyProfile;
import com.cartera.dto.market.DailyHistory;
import com.cartera.dto.market.DailyHistoryResult;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.HistoryResult;
import com.cartera.dto.market.InstrumentHit;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.dto.market.Listing;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import com.cartera.repository.MarketCacheRepository;
import com.cartera.util.Isin;
import com.cartera.util.MarketSymbols;
import com.cartera.util.Words;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Capa de caché sobre las fuentes de mercado: memoria con TTL para no pedir lo mismo en cada refresco y la tabla
 * {@code market_cache} como último dato conocido (sin conexión se sirve marcado {@code stale}).
 */
@Service
@Slf4j
public class MarketService {

    /** Sube la versión cuando AnalystTargets gane campos: así no se sirve la caché antigua sin ellos. */
    private static final String TARGETS_KIND = "targets-v2";
    /** Si falla la fuente del consenso, cuánto se espera para volver a pedirlo. */
    private static final long TARGETS_RETRY_MS = 5 * 60_000;
    private static final long HISTORY_TTL_MS = 60 * 60_000L;
    private static final long EMPTY_HISTORY_TTL_MS = 5 * 60_000L;
    private static final long PROFILE_TTL_MS = 30L * 24 * 60 * 60_000;
    private static final long ALL_CANDLES_TTL_MS = 6 * 60 * 60_000L;
    /**
     * Las velas diarias se renuevan cada minuto mientras el gráfico está abierto, pero en la base de datos solo hacen
     * falta como respaldo (sin conexión o tras un reinicio): se guardan como mucho cada seis horas. Escribir ~1.300
     * velas en cada vuelta impedía que la base de datos se durmiera.
     */
    private static final long CANDLES_PERSIST_MS = 6 * 60 * 60_000L;
    /** Los minigráficos usan observaciones diarias o mensuales: se renuevan cada 3 h. */
    private static final long SPARK_TTL_MS = 3 * 60 * 60_000L;
    /** Pausa entre históricos renovados en segundo plano, para no ir a ráfagas. */
    private static final long REFRESH_GAP_MS = 1_500;
    private static final long BACKOFF_START_MS = 60_000;
    private static final long BACKOFF_MAX_MS = 15 * 60_000L;
    private static final Pattern RATE_LIMIT = Pattern.compile("\\b429\\b|too many requests", Pattern.CASE_INSENSITIVE);
    private static final Pattern PREFIXED = Pattern.compile("^[A-Z]+:\\S+$", Pattern.CASE_INSENSITIVE);
    private static final Pattern ISIN_TICKER = Pattern.compile("^(?:FT:)?([A-Z]{2}[A-Z0-9]{9}\\d)[.:][A-Z]+$");

    /** Tipos sin consenso de analistas: no se pregunta por ellos. */
    public static final Set<String> NO_ANALYST_COVERAGE =
            Set.of("ETF", "MUTUALFUND", "INDEX", "CURRENCY", "CRYPTOCURRENCY", "FUTURE");

    /** Divisas que cotizan en centésimas (Londres en peniques, Tel Aviv en agorot…). */
    public record MinorUnit(String major, int factor) {
    }

    public static final Map<String, MinorUnit> MINOR_UNITS = Map.of(
            "GBp", new MinorUnit("GBP", 100),
            "GBX", new MinorUnit("GBP", 100),
            "ILA", new MinorUnit("ILS", 100),
            "ZAc", new MinorUnit("ZAR", 100));

    private record Entry<T>(T value, long fetchedAt) {
    }

    private static final TypeReference<List<PricePoint>> POINTS = new TypeReference<>() {
    };
    private static final TypeReference<List<Candle>> CANDLES = new TypeReference<>() {
    };

    private final MarketDataProvider provider;
    private final MarketCacheRepository cache;
    private final JsonMapper json;
    private final InstrumentCatalog catalog;
    private final OpenFigiClient figi;
    private final long quoteTtlMs;
    private final long targetsTtlMs;

    private final Cache<String, Entry<?>> mem = Caffeine.newBuilder().maximumSize(50_000).build();
    /** Cotizaciones nuevas aún sin guardar: se guardan juntas de vez en cuando ({@link #flushQuotes()}). */
    private final Set<String> quotesUnsaved = ConcurrentHashMap.newKeySet();
    /** Símbolos ya buscados en la base de datos como reserva: no se vuelven a leer. */
    private final Set<String> quotesLoaded = ConcurrentHashMap.newKeySet();
    private final Map<String, CompletableFuture<Quote>> quotePending = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<DailyHistoryResult>> dailyPending = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<CandlesResult>> candlesPending = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<CandlesResult>> allCandlesPending = new ConcurrentHashMap<>();
    /** Cuándo se guardaron por última vez las velas diarias de cada valor en la base de datos. */
    private final Map<String, Long> candlesPersistedAt = new ConcurrentHashMap<>();
    private final Map<String, HistoryRange> refreshQueue = new ConcurrentHashMap<>();
    private final AtomicBoolean refreshing = new AtomicBoolean();
    private final ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();

    /** Si la fuente limita las consultas, no se le vuelve a preguntar hasta esta hora (espera creciente). */
    private volatile long throttledUntil;
    private volatile long backoffMs = BACKOFF_START_MS;

    public MarketService(MarketDataProvider provider, MarketCacheRepository cache, JsonMapper json,
                         ObjectProvider<InstrumentCatalog> catalog, OpenFigiClient figi,
                         @Value("${app.market.quote-ttl-seconds}") long quoteTtlSeconds,
                         @Value("${app.market.targets-ttl-hours}") long targetsTtlHours) {
        this.provider = provider;
        this.cache = cache;
        this.json = json;
        this.catalog = catalog.getIfAvailable();
        this.figi = figi;
        this.quoteTtlMs = quoteTtlSeconds * 1000;
        this.targetsTtlMs = targetsTtlHours * 3_600_000;
    }

    public String providerId() {
        return provider.id();
    }

    /** Hora (ISO) hasta la que se pausan las consultas por límite de la fuente, o null. */
    public String throttledUntilIso() {
        return throttled() ? YahooProvider.ISO_MS.format(Instant.ofEpochMilli(throttledUntil)) : null;
    }

    /** Estado de las fuentes (pausas y últimos fallos) para diagnosticar desde /api/health. */
    public Map<String, Object> diagnostics() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("throttled", throttled());
        out.put("sources", provider.diagnostics());
        return out;
    }

    private boolean throttled() {
        return System.currentTimeMillis() < throttledUntil;
    }

    private void onProviderError(RuntimeException error, String what) {
        if (RATE_LIMIT.matcher(MarketSourceException.text(error)).find()) {
            throttledUntil = System.currentTimeMillis() + backoffMs;
            log.warn("La fuente limita las consultas: se reintenta en {} min", Math.round(backoffMs / 60_000.0));
            backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        } else {
            log.warn("{}: {}", what, MarketSourceException.summary(error));
        }
    }

    // ---------------------------------------------------------------- cotizaciones

    public void invalidateQuotes() {
        mem.asMap().keySet().removeIf(k -> k.startsWith("quote:"));
    }

    public Map<String, Quote> getQuotes(List<String> symbols) {
        return getQuotes(symbols, false, quoteTtlMs);
    }

    /** Antigüedad máxima normal de una cotización. */
    public long quoteTtlMs() {
        return quoteTtlMs;
    }

    /**
     * Cotizaciones con caché de {@code quoteTtl}. {@code maxAgeMs} la acorta (el gráfico abierto y la lista en
     * pantalla piden sus precios cada dos segundos): las pantallas que lo piden a la vez comparten una sola petición
     * a la fuente. Los fondos (valor liquidativo diario, {@code asOf}) no se piden más a menudo.
     */
    public Map<String, Quote> getQuotes(List<String> symbols, boolean force, long maxAgeMs) {
        Map<String, Quote> out = new LinkedHashMap<>();
        long now = System.currentTimeMillis();
        List<String> missing = new ArrayList<>();
        for (String sym : new LinkedHashSet<>(symbols)) {
            Entry<Quote> hit = memGet("quote:" + sym);
            long ttl = hit != null && hit.value().asOf() != null ? quoteTtlMs : Math.min(maxAgeMs, quoteTtlMs);
            if (!force && hit != null && now - hit.fetchedAt() < ttl) out.put(sym, hit.value());
            else missing.add(sym);
        }
        if (missing.isEmpty()) return out;

        // Una sola petición por símbolo aunque lo pidan a la vez varias pantallas, cuentas o el bucle de avisos.
        Map<String, CompletableFuture<Quote>> mine = new LinkedHashMap<>();
        Map<String, CompletableFuture<Quote>> waits = new LinkedHashMap<>();
        for (String sym : missing) {
            CompletableFuture<Quote> f = new CompletableFuture<>();
            CompletableFuture<Quote> existing = quotePending.putIfAbsent(sym, f);
            if (existing == null) mine.put(sym, f);
            waits.put(sym, existing != null ? existing : f);
        }
        if (!mine.isEmpty()) {
            try {
                Map<String, Quote> fetched = fetchQuotes(new ArrayList<>(mine.keySet()));
                mine.forEach((sym, f) -> f.complete(fetched.get(sym)));
            } catch (RuntimeException e) {
                mine.values().forEach(f -> f.complete(null));
                throw e;
            } finally {
                mine.forEach(quotePending::remove);
            }
        }
        waits.forEach((sym, f) -> {
            Quote q = join(f);
            if (q != null) out.put(sym, q);
        });
        return out;
    }

    private Map<String, Quote> fetchQuotes(List<String> missing) {
        Map<String, Quote> out = new HashMap<>();
        long now = System.currentTimeMillis();
        List<Quote> fetched = List.of();
        if (!throttled()) {
            try {
                fetched = provider.getQuotes(missing);
                backoffMs = BACKOFF_START_MS;
            } catch (RuntimeException e) {
                onProviderError(e, "No se pudieron obtener cotizaciones (" + String.join(", ", missing) + ")");
            }
        }
        Map<String, Quote> bySymbol = new HashMap<>();
        for (Quote q : fetched) bySymbol.put(q.symbol().toUpperCase(Locale.ROOT), q);
        for (String sym : missing) {
            Quote q = bySymbol.get(sym.toUpperCase(Locale.ROOT));
            if (q != null) {
                Quote quote = q.withSymbol(sym).withStale(false);
                mem.put("quote:" + sym, new Entry<>(quote, now));
                // En directo llega una cada pocos segundos: se guarda en la base de datos solo de vez en cuando, como
                // reserva para cuando la fuente falle tras un reinicio. Así el vigilante no la despierta.
                quotesUnsaved.add(sym);
                out.put(sym, quote);
            } else {
                // Sin precio nuevo: el último en memoria y, si no hay, el guardado (se lee una sola vez).
                Entry<Quote> last = memGet("quote:" + sym);
                if (last == null && quotesLoaded.add(sym)) {
                    last = load("quote", sym, Quote.class);
                    if (last != null && last.value() != null) mem.put("quote:" + sym, last);
                }
                if (last != null && last.value() != null) out.put(sym, last.value().withStale(true));
            }
        }
        return out;
    }

    /** Guarda en la base de datos las cotizaciones nuevas (cada pocas horas y al apagar). */
    @Scheduled(initialDelay = 6, fixedDelay = 6, timeUnit = TimeUnit.HOURS)
    @PreDestroy
    public void flushQuotes() {
        for (String sym : List.copyOf(quotesUnsaved)) {
            quotesUnsaved.remove(sym);
            Entry<Quote> e = memGet("quote:" + sym);
            if (e == null || e.value() == null) continue;
            try {
                cache.save("quote", sym, e.value());
            } catch (RuntimeException ex) {
                log.warn("No se pudo guardar la cotización de {}: {}", sym, ex.toString());
            }
        }
    }

    // ---------------------------------------------------------------- consenso

    public Map<String, AnalystTargets> getTargets(List<String> symbols, boolean force) {
        Map<String, AnalystTargets> out = new ConcurrentHashMap<>();
        Set<String> nulls = ConcurrentHashMap.newKeySet();
        forEach(new ArrayList<>(new LinkedHashSet<>(symbols)), 4, sym -> {
            String key = TARGETS_KIND + ":" + sym;
            Entry<AnalystTargets> cached = memGet(key);
            if (cached == null) cached = load(TARGETS_KIND, sym, AnalystTargets.class);
            if ((!force && cached != null && System.currentTimeMillis() - cached.fetchedAt() < targetsTtlMs) || throttled()) {
                // Con la fuente parada y nada guardado, se recuerda el hueco un rato para no leer la base de datos cada vez.
                mem.put(key, cached != null ? cached : new Entry<>(null, System.currentTimeMillis() - targetsTtlMs + TARGETS_RETRY_MS));
                put(out, nulls, sym, cached != null ? cached.value() : null);
                return;
            }
            try {
                AnalystTargets t = provider.getTargets(sym);
                AnalystTargets value = t != null ? t.withFetchedAt(isoNow()) : null;
                mem.put(key, new Entry<>(value, System.currentTimeMillis()));
                cache.save(TARGETS_KIND, sym, value);
                put(out, nulls, sym, value);
            } catch (RuntimeException e) {
                onProviderError(e, "Sin consenso para " + sym);
                // Lo que hubiera vale un rato más: no se vuelve a leer la base de datos ni a pedir en cada vuelta.
                AnalystTargets value = cached != null ? cached.value() : null;
                mem.put(key, new Entry<>(value, System.currentTimeMillis() - targetsTtlMs + TARGETS_RETRY_MS));
                put(out, nulls, sym, value);
            }
        });
        // El mapa admite null: «la fuente no tiene consenso» para ese valor.
        Map<String, AnalystTargets> result = new LinkedHashMap<>();
        for (String sym : new LinkedHashSet<>(symbols)) result.put(sym, nulls.contains(sym) ? null : out.get(sym));
        return result;
    }

    private static <T> void put(Map<String, T> out, Set<String> nulls, String key, T value) {
        if (value == null) nulls.add(key);
        else out.put(key, value);
    }

    // ---------------------------------------------------------------- tipos de cambio

    /**
     * Tipos de cambio: unidades de cada divisa por 1 de {@code base}. Las divisas en centésimas (GBp) llevan el
     * factor ×100. {@code date} pide el cierre de ese día; {@code staleOut} recoge las que salen de lo guardado.
     */
    public Map<String, Double> getFxRates(String base, List<String> currencies, LocalDate date, Set<String> staleOut) {
        Map<String, Double> rates = new ConcurrentHashMap<>();
        rates.put(base, 1.0);
        Set<String> majors = new LinkedHashSet<>();
        for (String c : currencies) {
            if (c != null) majors.add(MINOR_UNITS.containsKey(c) ? MINOR_UNITS.get(c).major() : c);
        }
        majors.remove(base);
        if (date != null) {
            // Cierre de ese día (o el último anterior: fines de semana y festivos).
            String day = date.toString();
            forEach(new ArrayList<>(majors), majors.size(), c -> {
                List<PricePoint> points = getDailyHistory(base + c + "=X", date.minusDays(10)).points();
                Double p = null;
                for (PricePoint x : points) if (x.t().substring(0, 10).compareTo(day) <= 0) p = x.c();
                if (p != null && p > 0) rates.put(c, p);
            });
        } else {
            List<String> pairs = majors.stream().map(c -> base + c + "=X").toList();
            Map<String, Quote> quotes = getQuotes(pairs);
            for (String c : majors) {
                Quote q = quotes.get(base + c + "=X");
                if (q == null || q.price() == null || q.price() == 0) continue;
                rates.put(c, q.price());
                // Cambio guardado de una consulta anterior: la valoración en esa divisa no está al día.
                if (q.stale() && staleOut != null) staleOut.add(c);
            }
        }
        for (String c : currencies) {
            MinorUnit minor = c != null ? MINOR_UNITS.get(c) : null;
            if (minor != null && rates.containsKey(minor.major())) {
                rates.put(c, rates.get(minor.major()) * minor.factor());
                if (staleOut != null && staleOut.contains(minor.major())) staleOut.add(c);
            }
        }
        return new LinkedHashMap<>(rates);
    }

    // ---------------------------------------------------------------- búsqueda

    /**
     * Búsqueda por nombre o ticker; si es un ISIN, se traduce con OpenFIGI a tickers de Yahoo y se comprueban. Con
     * ISIN se juntan los resultados de las fuentes directas (fondos, bolsas alemanas de onvista) y los de Yahoo.
     */
    public List<SymbolSearchResult> search(String query) {
        if (!Isin.isIsin(query)) return byName(query);
        List<SymbolSearchResult> direct = safeSearch(query);
        // Las bolsas de onvista van al final: Yahoo da además gráficos e históricos.
        List<SymbolSearchResult> venues = direct.stream().filter(r -> MarketSymbols.isVenueSymbol(r.symbol())).toList();
        List<SymbolSearchResult> ft = direct.stream().filter(r -> MarketSymbols.parseFtSymbol(r.symbol()) != null).toList();
        List<SymbolSearchResult> own = direct.stream()
                .filter(r -> !MarketSymbols.isVenueSymbol(r.symbol()) && MarketSymbols.parseFtSymbol(r.symbol()) == null)
                .toList();
        // FT encuentra casi cualquier ISIN: no cuenta como fuente directa para dejar de consultar Yahoo.
        List<SymbolSearchResult> out = new ArrayList<>(own.isEmpty() ? isinYahoo(query) : own);
        out.addAll(ft);
        out.addAll(venues);
        return out;
    }

    /**
     * Productos que encajan con un nombre, ISIN o WKN (paso 1 del buscador: qué valor es). Además del catálogo, los
     * tickers de Yahoo que llevan el ISIN en el símbolo (p. ej. JE00B588CD74.SG) también son un producto. Primero los
     * que más palabras de la búsqueda tienen en el nombre.
     */
    public List<InstrumentHit> instruments(String rawQuery) {
        String query = rawQuery;
        // Un símbolo con prefijo (FT:SEC0:GER:EUR, XETRA:IE00…) no es un nombre: si lleva el ISIN se busca por él.
        if (PREFIXED.matcher(query.trim()).matches()) {
            String isin = null;
            for (String part : query.toUpperCase(Locale.ROOT).split(":")) {
                if (Isin.isIsin(part)) {
                    isin = part;
                    break;
                }
            }
            if (isin == null) return List.of();
            query = isin;
        }
        final String q = query;
        CompletableFuture<List<InstrumentHit>> fromCatalog = CompletableFuture.supplyAsync(() -> {
            if (catalog == null) return List.of();
            try {
                return catalog.findInstruments(q);
            } catch (RuntimeException e) {
                log.warn("No se pudo buscar el producto «{}»: {}", q, MarketSourceException.summary(e));
                return List.of();
            }
        }, workers);
        List<SymbolSearchResult> tickers = Isin.isIsin(q) || q.trim().length() < 3 ? List.of() : safeByName(q);
        List<InstrumentHit> all = new ArrayList<>(join(fromCatalog));
        for (SymbolSearchResult r : tickers) {
            Matcher m = ISIN_TICKER.matcher(r.symbol());
            if (!m.matches() || !Isin.isIsin(m.group(1))) continue;
            // Yahoo marca estos símbolos de Stuttgart como fondo aunque sean ETC o acciones: mejor sin tipo que uno falso.
            all.add(new InstrumentHit(m.group(1), r.name(), r.symbol().startsWith("FT:") ? r.type() : null));
        }
        Map<String, InstrumentHit> byIsin = new LinkedHashMap<>();
        for (InstrumentHit hit : all) byIsin.putIfAbsent(hit.isin(), hit);
        List<String> words = Words.queryWords(q);
        List<InstrumentHit> hits = new ArrayList<>(byIsin.values());
        // Orden estable: a igual puntuación se mantiene el de las fuentes.
        hits.sort(Comparator.comparingInt((InstrumentHit h) -> Words.wordScore(h.name(), words)).reversed());
        return hits.subList(0, Math.min(12, hits.size()));
    }

    /**
     * Búsqueda por nombre o ticker. Si un nombre largo no da nada, reintenta por parejas de palabras y deja los
     * resultados que tienen al menos dos palabras de la búsqueda.
     */
    private List<SymbolSearchResult> byName(String query) {
        List<SymbolSearchResult> found = provider.search(query);
        List<String> pairs = Words.wordPairs(query);
        if (!found.isEmpty() || pairs.isEmpty()) return found;
        List<CompletableFuture<List<SymbolSearchResult>>> calls = pairs.stream()
                .map(p -> CompletableFuture.supplyAsync(() -> safeSearch(p), workers)).toList();
        List<List<SymbolSearchResult>> lists = calls.stream().map(MarketService::join).toList();
        return Words.rankByWords(query, lists, SymbolSearchResult::symbol, SymbolSearchResult::name);
    }

    private List<SymbolSearchResult> safeByName(String query) {
        try {
            return byName(query);
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    private List<SymbolSearchResult> safeSearch(String query) {
        try {
            return provider.search(query);
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    /**
     * Bolsas donde se puede seguir un ISIN, con su precio (paso 2: dónde). Primero las que tienen gráfico. Se juntan
     * lo que las fuentes dan por ISIN, la traducción de OpenFIGI y los tickers de Yahoo con el mismo nombre de
     * producto (Yahoo no encuentra por ISIN, p. ej., SGBS.MI ni GZURD.XD).
     */
    public List<Listing> listings(String isin) {
        CompletableFuture<List<SymbolSearchResult>> directF = CompletableFuture.supplyAsync(() -> safeSearch(isin), workers);
        CompletableFuture<List<SymbolSearchResult>> figiF = CompletableFuture.supplyAsync(() -> isinYahoo(isin), workers);
        List<InstrumentHit> products = instruments(isin);
        InstrumentHit product = products.isEmpty() ? null : products.getFirst();
        List<SymbolSearchResult> named = product == null ? List.of()
                : safeByName(product.name()).stream().filter(r -> Words.sameName(r.name(), product.name())).toList();
        List<SymbolSearchResult> figiFound = join(figiF);

        Map<String, SymbolSearchResult> bySymbol = new LinkedHashMap<>();
        for (List<SymbolSearchResult> list : List.of(join(directF), figiFound, named)) {
            for (SymbolSearchResult r : list) bySymbol.putIfAbsent(r.symbol(), r);
        }
        List<SymbolSearchResult> found = new ArrayList<>(bySymbol.values());
        if (found.size() > 24) found = found.subList(0, 24);
        Map<String, Quote> quotes = getQuotes(found.stream().map(SymbolSearchResult::symbol).toList());
        Set<String> figiSymbols = new java.util.HashSet<>();
        for (SymbolSearchResult f : figiFound) figiSymbols.add(f.symbol());

        List<Listing> out = new ArrayList<>();
        for (SymbolSearchResult r : found) {
            Quote q = quotes.get(r.symbol());
            // Con el mismo nombre es el mismo producto aunque la fuente lo clasifique distinto (un ETC como acción).
            // Tampoco se duda de lo que traduce OpenFIGI, que va por ISIN y bolsa.
            boolean trusted = figiSymbols.contains(r.symbol()) || (product != null
                    && (Words.sameName(r.name(), product.name()) || (q != null && q.name() != null && Words.sameName(q.name(), product.name()))));
            boolean hasIsin = r.symbol().toUpperCase(Locale.ROOT).startsWith(isin.toUpperCase(Locale.ROOT));
            if (!trusted && !sameKind(product != null ? product.type() : null, q != null ? q.quoteType() : null, hasIsin)) continue;
            boolean priceOnly = MarketSymbols.isVenueSymbol(r.symbol()) || (q != null && "onvista".equals(q.source()));
            String exchange = priceOnly && q != null && q.exchange() != null ? q.exchange() : r.exchange();
            out.add(new Listing(r.symbol(), r.name(), exchange, r.type(), q != null ? q.currency() : null,
                    q != null && !q.stale() ? q.price() : null, priceOnly));
        }
        List<Listing> kept = pricedLikeTheRest(out);
        kept.sort(Comparator.comparing(Listing::priceOnly).thenComparing(l -> l.price() == null));
        return kept;
    }

    private List<SymbolSearchResult> isinYahoo(String query) {
        List<String> candidates = figi.candidates(query);
        if (candidates.isEmpty()) return List.of();
        Map<String, Quote> quotes = getQuotes(candidates);
        List<SymbolSearchResult> out = new ArrayList<>();
        for (String s : candidates) {
            Quote q = quotes.get(s);
            if (q == null || q.stale()) continue;
            out.add(new SymbolSearchResult(q.symbol(), q.name() != null ? q.name() : q.symbol(), q.exchange(), q.quoteType()));
        }
        return out;
    }

    /**
     * Las fuentes devuelven a veces por un ISIN algo que no es ese producto: una acción entre las bolsas de un ETF (o
     * al revés). Los símbolos que llevan el propio ISIN se libran: Yahoo marca como fondo todo lo de Stuttgart.
     */
    static boolean sameKind(String productType, String quoteType, boolean hasIsin) {
        if (productType == null || quoteType == null || hasIsin) return true;
        boolean productEquity = "EQUITY".equalsIgnoreCase(productType);
        boolean quoteEquity = "EQUITY".equalsIgnoreCase(quoteType);
        return !((MarketSymbols.isFundType(productType) && quoteEquity) || (productEquity && MarketSymbols.isFundType(quoteType)));
    }

    /**
     * El mismo producto vale casi lo mismo en todas las bolsas de una divisa. Un precio que se aparta más de un 8 % de
     * la mediana de su divisa es otro valor o un precio viejo que la fuente no marca (p. ej. 1NVDA.MI): se quita.
     */
    static List<Listing> pricedLikeTheRest(List<Listing> all) {
        Map<String, List<Double>> byCurrency = new HashMap<>();
        for (Listing l : all) {
            if (l.price() != null && l.currency() != null) byCurrency.computeIfAbsent(l.currency(), k -> new ArrayList<>()).add(l.price());
        }
        Map<String, Double> medians = new HashMap<>();
        byCurrency.forEach((currency, prices) -> {
            if (prices.size() < 3) return;
            prices.sort(null);
            medians.put(currency, prices.get(prices.size() / 2));
        });
        List<Listing> out = new ArrayList<>();
        for (Listing l : all) {
            Double median = l.currency() != null ? medians.get(l.currency()) : null;
            if (l.price() == null || median == null || Math.abs(l.price() / median - 1) <= 0.08) out.add(l);
        }
        return out;
    }

    // ---------------------------------------------------------------- históricos

    public DailyHistoryResult getDailyHistory(String symbol, LocalDate from) {
        String start = from.minusDays(7).getYear() + "-01-01";
        return once(dailyPending, start + ":" + symbol, () -> loadDailyHistory(symbol, start));
    }

    private DailyHistoryResult loadDailyHistory(String symbol, String start) {
        String kind = "daily-v1-" + start;
        String key = kind + ":" + symbol;
        Entry<DailyHistory> cached = memGet(key);
        if (cached == null) cached = load(kind, symbol, DailyHistory.class);
        if (cached != null && cached.value() != null && System.currentTimeMillis() - cached.fetchedAt() < HISTORY_TTL_MS) {
            mem.put(key, cached);
            return DailyHistoryResult.of(cached.value(), false);
        }
        if (!throttled()) {
            try {
                DailyHistory value = provider.getDailyHistory(symbol, LocalDate.parse(start));
                if (value == null) value = DailyHistory.EMPTY;
                if (value.points().isEmpty() && cached != null && cached.value() != null && !cached.value().points().isEmpty()) {
                    throw new MarketSourceException("Sin cierres diarios actualizados");
                }
                mem.put(key, new Entry<>(value, System.currentTimeMillis()));
                cache.save(kind, symbol, value);
                return DailyHistoryResult.of(value, false);
            } catch (RuntimeException e) {
                onProviderError(e, "Sin histórico diario de " + symbol);
            }
        }
        return DailyHistoryResult.of(cached != null && cached.value() != null ? cached.value() : DailyHistory.EMPTY, true);
    }

    /** Histórico de cierres (caché 1 h; sin conexión, el último guardado). */
    public HistoryResult getHistory(String symbol, HistoryRange range) {
        String kind = "history-" + range.id();
        String key = kind + ":" + symbol;
        Entry<List<PricePoint>> hit = memGet(key);
        // Tras un reinicio (cada publicación) la memoria está vacía: lo guardado vale si es reciente, para no pedir a
        // Yahoo el histórico de toda la lista de golpe (eso es lo que le hace limitarnos).
        if (hit == null) {
            hit = load(kind, symbol, POINTS);
            if (hit != null) mem.put(key, hit);
        }
        if (hit != null && hit.value() != null
                && System.currentTimeMillis() - hit.fetchedAt() < (hit.value().isEmpty() ? EMPTY_HISTORY_TTL_MS : HISTORY_TTL_MS)) {
            return new HistoryResult(hit.value(), false);
        }
        if (!throttled()) {
            try {
                List<PricePoint> points = provider.getHistory(symbol, range);
                if (points.isEmpty() && hit != null && hit.value() != null && !hit.value().isEmpty()) {
                    throw new MarketSourceException("Sin cierres históricos");
                }
                mem.put(key, new Entry<>(points, System.currentTimeMillis()));
                cache.save(kind, symbol, points);
                return new HistoryResult(points, false);
            } catch (RuntimeException e) {
                onProviderError(e, "Sin histórico de " + symbol);
            }
        }
        Entry<List<PricePoint>> stored = load(kind, symbol, POINTS);
        return new HistoryResult(stored != null && stored.value() != null ? stored.value() : List.of(), true);
    }

    /**
     * Cierres del periodo de varios valores, para los minigráficos de las tablas. Lo guardado se sirve al momento
     * aunque tenga horas; lo viejo se renueva en segundo plano de uno en uno.
     */
    public Map<String, List<Double>> getSparklines(List<String> symbols, HistoryRange range) {
        Map<String, List<Double>> out = new ConcurrentHashMap<>();
        String kind = "history-" + range.id();
        List<String> unique = new ArrayList<>(new LinkedHashSet<>(symbols));
        forEach(unique, 2, sym -> {
            String key = kind + ":" + sym;
            Entry<List<PricePoint>> hit = memGet(key);
            if (hit == null) {
                hit = load(kind, sym, POINTS);
                if (hit != null) mem.put(key, hit);
            }
            long age = hit != null ? System.currentTimeMillis() - hit.fetchedAt() : Long.MAX_VALUE;
            // Reintentar pronto los vacíos permite aprovechar nuevas fuentes o cobertura recuperada.
            if (hit != null && hit.value() != null && (!hit.value().isEmpty() || age < EMPTY_HISTORY_TTL_MS)) {
                out.put(sym, closes(hit.value()));
                if (age >= SPARK_TTL_MS) queueRefresh(sym, range);
                return;
            }
            out.put(sym, closes(getHistory(sym, range).points()));
        });
        Map<String, List<Double>> ordered = new LinkedHashMap<>();
        for (String sym : unique) ordered.put(sym, out.getOrDefault(sym, List.of()));
        return ordered;
    }

    private static List<Double> closes(List<PricePoint> points) {
        return points.stream().map(PricePoint::c).toList();
    }

    /** Renueva históricos viejos poco a poco, sin bloquear la respuesta. Se para si la fuente nos limita. */
    private void queueRefresh(String symbol, HistoryRange range) {
        refreshQueue.put(range.id() + ":" + symbol, range);
        if (!refreshing.compareAndSet(false, true)) return;
        Thread.ofVirtual().name("market-refresh").start(() -> {
            try {
                while (!refreshQueue.isEmpty() && !throttled()) {
                    var next = refreshQueue.entrySet().iterator().next();
                    refreshQueue.remove(next.getKey());
                    HistoryRange r = next.getValue();
                    String sym = next.getKey().substring(r.id().length() + 1);
                    String key = "history-" + r.id() + ":" + sym;
                    Entry<?> hit = mem.getIfPresent(key);
                    if (hit != null && System.currentTimeMillis() - hit.fetchedAt() < SPARK_TTL_MS) continue;
                    mem.invalidate(key);
                    try {
                        getHistory(sym, r);
                    } catch (RuntimeException e) {
                        log.debug("Sin histórico de {} en segundo plano: {}", sym, e.getMessage());
                    }
                    Thread.sleep(REFRESH_GAP_MS);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                refreshQueue.clear();
                refreshing.set(false);
            }
        });
    }

    // ---------------------------------------------------------------- velas

    /**
     * Velas del gráfico: diarias de los últimos cinco años ({@code interval} null) o intradía recientes. La última va
     * en directo, así que la caché dura lo mismo que la de las cotizaciones; si las fuentes fallan, se sirven las
     * últimas guardadas (las intradía solo en memoria: son muchas y caducan enseguida).
     */
    public CandlesResult getCandles(String symbol, IntradayInterval interval) {
        String id = (interval == null ? "1d" : interval.name()) + ":" + symbol;
        return once(candlesPending, id, () -> loadCandles(symbol, interval));
    }

    private CandlesResult loadCandles(String symbol, IntradayInterval interval) {
        boolean daily = interval == null;
        String kind = daily ? "candles-5y" : "candles-" + interval.name();
        String key = kind + ":" + symbol;
        Entry<List<Candle>> hit = memGet(key);
        if (hit != null && System.currentTimeMillis() - hit.fetchedAt() < Math.max(quoteTtlMs, 30_000)) {
            return new CandlesResult(hit.value(), false);
        }
        if (!throttled()) {
            try {
                List<Candle> candles = daily
                        ? provider.getCandles(symbol, LocalDate.now(ZoneOffset.UTC).minusDays(5 * 366))
                        : provider.getIntradayCandles(symbol, interval);
                if (candles != null && !candles.isEmpty()) {
                    long now = System.currentTimeMillis();
                    mem.put(key, new Entry<>(candles, now));
                    if (daily && now - candlesPersistedAt.getOrDefault(symbol, 0L) >= CANDLES_PERSIST_MS) {
                        cache.save(kind, symbol, candles);
                        candlesPersistedAt.put(symbol, now);
                    }
                    return new CandlesResult(candles, false);
                }
            } catch (RuntimeException e) {
                onProviderError(e, "Sin velas de " + symbol);
            }
        }
        Entry<List<Candle>> stored = hit != null ? hit : daily ? load(kind, symbol, CANDLES) : null;
        return new CandlesResult(stored != null && stored.value() != null ? stored.value() : List.of(), true);
    }

    /**
     * Velas diarias de toda la historia del valor, para cuando el gráfico se aleja más allá de los cinco años. Lo
     * antiguo no cambia: caché de seis horas y, sin conexión, lo último guardado.
     */
    public CandlesResult getAllCandles(String symbol) {
        return once(allCandlesPending, symbol, () -> loadAllCandles(symbol));
    }

    private CandlesResult loadAllCandles(String symbol) {
        String kind = "candles-max";
        String key = kind + ":" + symbol;
        Entry<List<Candle>> hit = memGet(key);
        if (hit != null && System.currentTimeMillis() - hit.fetchedAt() < ALL_CANDLES_TTL_MS) {
            return new CandlesResult(hit.value(), false);
        }
        if (!throttled()) {
            try {
                List<Candle> candles = provider.getCandles(symbol, LocalDate.of(1970, 1, 1));
                if (candles != null && !candles.isEmpty()) {
                    mem.put(key, new Entry<>(candles, System.currentTimeMillis()));
                    cache.save(kind, symbol, candles);
                    return new CandlesResult(candles, false);
                }
            } catch (RuntimeException e) {
                onProviderError(e, "Sin histórico completo de " + symbol);
            }
        }
        Entry<List<Candle>> stored = hit != null ? hit : load(kind, symbol, CANDLES);
        return new CandlesResult(stored != null && stored.value() != null ? stored.value() : List.of(), true);
    }

    // ---------------------------------------------------------------- ficha

    /** Ficha de la empresa (sector y nombre). Cambia poco: se guarda 30 días. null si no hay. */
    public CompanyProfile getProfile(String symbol) {
        Entry<CompanyProfile> stored = load("profile", symbol, CompanyProfile.class);
        if (stored != null && System.currentTimeMillis() - stored.fetchedAt() < PROFILE_TTL_MS) return stored.value();
        if (throttled()) return stored != null ? stored.value() : null;
        try {
            CompanyProfile profile = provider.getProfile(symbol);
            cache.save("profile", symbol, profile);
            return profile;
        } catch (RuntimeException e) {
            onProviderError(e, "Sin ficha de " + symbol);
            return stored != null ? stored.value() : null;
        }
    }

    // ---------------------------------------------------------------- utilidades

    @SuppressWarnings("unchecked")
    private <T> Entry<T> memGet(String key) {
        return (Entry<T>) mem.getIfPresent(key);
    }

    private <T> Entry<T> load(String kind, String symbol, Class<T> type) {
        MarketCacheRepository.Row row = cache.find(kind, symbol);
        if (row == null) return null;
        try {
            JsonNode data = row.data();
            return new Entry<>(data == null || data.isNull() ? null : json.treeToValue(data, type), row.fetchedAtMillis());
        } catch (RuntimeException e) {
            log.warn("Dato guardado ilegible ({} de {}): {}", kind, symbol, e.getMessage());
            return null;
        }
    }

    private <T> Entry<T> load(String kind, String symbol, TypeReference<T> type) {
        MarketCacheRepository.Row row = cache.find(kind, symbol);
        if (row == null) return null;
        try {
            JsonNode data = row.data();
            return new Entry<>(data == null || data.isNull() ? null : json.convertValue(data, type), row.fetchedAtMillis());
        } catch (RuntimeException e) {
            log.warn("Dato guardado ilegible ({} de {}): {}", kind, symbol, e.getMessage());
            return null;
        }
    }

    /** Una sola carga por clave aunque la pidan a la vez varias peticiones: las demás esperan su resultado. */
    private static <T> T once(Map<String, CompletableFuture<T>> pending, String key, Supplier<T> load) {
        CompletableFuture<T> mine = new CompletableFuture<>();
        CompletableFuture<T> existing = pending.putIfAbsent(key, mine);
        if (existing != null) return join(existing);
        try {
            T value = load.get();
            mine.complete(value);
            return value;
        } catch (RuntimeException e) {
            mine.completeExceptionally(e);
            throw e;
        } finally {
            pending.remove(key, mine);
        }
    }

    private static <T> T join(CompletableFuture<T> f) {
        try {
            return f.join();
        } catch (CompletionException e) {
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw e;
        }
    }

    /** Recorre {@code items} con, como mucho, {@code limit} a la vez (hilos virtuales). */
    private void forEach(List<String> items, int limit, Consumer<String> fn) {
        if (items.isEmpty()) return;
        if (items.size() == 1) {
            fn.accept(items.getFirst());
            return;
        }
        Semaphore permits = new Semaphore(Math.max(1, limit));
        List<CompletableFuture<Void>> tasks = new ArrayList<>();
        for (String item : items) {
            tasks.add(CompletableFuture.runAsync(() -> {
                permits.acquireUninterruptibly();
                try {
                    fn.accept(item);
                } finally {
                    permits.release();
                }
            }, workers));
        }
        tasks.forEach(MarketService::join);
    }

    private static String isoNow() {
        return YahooProvider.ISO_MS.format(Instant.now());
    }
}
