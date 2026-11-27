package com.cartera.service.market.composition;

import com.cartera.dto.market.FundComposition;
import com.cartera.repository.MarketCacheRepository;
import com.cartera.service.market.MarketSourceException;
import com.cartera.service.market.OpenFigiClient;
import com.cartera.service.market.YahooProvider;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Composición de fondos y ETF: qué empresas llevan dentro y con qué peso. Se prueban las fuentes en orden
 * (Financial Hub → extraETF → onvista → FT → Yahoo) y vale la primera que responde con datos coherentes.
 * Las posiciones que llegan solo con ISIN se completan con su ticker (OpenFIGI).
 */
@Slf4j
@Service
public class CompositionService {

    /** v3: Financial Hub da la cartera completa, también por ticker; las de antes solo tenían las 10 mayores. */
    static final String KIND = "holdings-v3";
    static final String ISIN_TICKER_KIND = "isin-ticker";
    /** Las gestoras publican la composición una vez al mes: una semana de caché; un día si ninguna fuente la tenía. */
    private static final long TTL_MS = 7 * 24 * 3_600_000L;
    private static final long EMPTY_TTL_MS = 24 * 3_600_000L;
    /** Un ISIN que OpenFIGI no conoce se vuelve a preguntar al cabo de un mes, por si lo ha dado de alta. */
    private static final long UNKNOWN_TICKER_TTL_MS = 30 * 24 * 3_600_000L;

    private final List<CompositionSource> sources;
    private final MarketCacheRepository cache;
    private final JsonMapper json;
    private final OpenFigiClient figi;
    private final Map<String, CompletableFuture<FundComposition>> pending = new ConcurrentHashMap<>();
    /** Ticker de cada ISIN ya resuelto (el valor vacío es «OpenFIGI no lo conoce»). */
    private final Map<String, String> isinTicker = new ConcurrentHashMap<>();
    /**
     * Las consultas a OpenFIGI van de una en una (sin clave admite pocas por minuto), pero en segundo plano y no en el
     * camino de la petición: quien pide una composición espera como mucho {@link #figiWaitMs}, no a toda la cola.
     * ReentrantLock y no synchronized: en Java 21 un hilo virtual que espera la red dentro de synchronized bloquea su hilo real.
     */
    private final ReentrantLock figiLock = new ReentrantLock();
    private final ExecutorService figiWorkers = Executors.newVirtualThreadPerTaskExecutor();
    /** Cuánto se espera a OpenFIGI antes de servir la composición sin los tickers que falten (se completan después). */
    long figiWaitMs = 2_000;

    public CompositionService(List<CompositionSource> sources, MarketCacheRepository cache, JsonMapper json, OpenFigiClient figi) {
        this.sources = sources;
        this.cache = cache;
        this.json = json;
        this.figi = figi;
    }

    /** Composición de un fondo o ETF, de la primera fuente que la tenga. null si ninguna lo conoce. */
    public FundComposition getComposition(CompositionSource.Ref ref) {
        String raw = ref.isin() != null ? ref.isin() : ref.symbol();
        if (raw == null || raw.isBlank() || sources.isEmpty()) return null;
        String key = raw.toUpperCase(Locale.ROOT);
        CompletableFuture<FundComposition> mine = new CompletableFuture<>();
        CompletableFuture<FundComposition> running = pending.putIfAbsent(key, mine);
        if (running != null) return running.join();
        try {
            FundComposition value = withTickers(load(key, ref));
            mine.complete(value);
            return value;
        } catch (RuntimeException e) {
            mine.completeExceptionally(e);
            throw e;
        } finally {
            pending.remove(key, mine);
        }
    }

    private FundComposition load(String key, CompositionSource.Ref ref) {
        MarketCacheRepository.Row row = cache.find(KIND, key);
        FundComposition stored = row != null && row.data() != null && !row.data().isNull()
                ? json.treeToValue(row.data(), FundComposition.class) : null;
        if (row != null && System.currentTimeMillis() - row.fetchedAtMillis() < (stored != null ? TTL_MS : EMPTY_TTL_MS)) {
            return stored;
        }
        boolean failed = false;
        for (CompositionSource source : sources) {
            try {
                CompositionSource.Result found = source.getComposition(ref);
                if (found == null) continue;
                FundComposition value = new FundComposition(found.holdings(), found.asOf(), source.id(),
                        YahooProvider.ISO_MS.format(Instant.now()));
                cache.save(KIND, key, value);
                return value;
            } catch (RuntimeException e) {
                failed = true;
                log.warn("Sin composición de {} en {}; se prueba la siguiente fuente: {}", key, source.id(),
                        MarketSourceException.summary(e));
            }
        }
        // Mejor la última conocida que nada; «no existe» solo se recuerda si todas las fuentes han contestado.
        if (stored != null) return stored;
        if (!failed) cache.save(KIND, key, null);
        return null;
    }

    /**
     * Financial Hub da las posiciones por ISIN, sin ticker: se completa con OpenFIGI (IBM, OHLA) para reconocerlas
     * de un vistazo. Cada ISIN se pregunta una vez y se guarda; si OpenFIGI no contesta, se queda sin ticker hasta otra vez.
     */
    private FundComposition withTickers(FundComposition comp) {
        if (comp == null) return null;
        List<String> missing = comp.holdings().stream()
                .filter(h -> h.ticker() == null && h.isin() != null)
                .map(h -> h.isin().toUpperCase(Locale.ROOT)).distinct()
                .filter(i -> !isinTicker.containsKey(i)).toList();
        if (!missing.isEmpty()) {
            long now = System.currentTimeMillis();
            cache.findAll(ISIN_TICKER_KIND, missing).forEach((isin, r) -> {
                String ticker = text(r.data());
                if (ticker != null || now - r.fetchedAtMillis() < UNKNOWN_TICKER_TTL_MS) isinTicker.put(isin, ticker != null ? ticker : "");
            });
            List<String> ask = missing.stream().filter(i -> !isinTicker.containsKey(i)).toList();
            if (!ask.isEmpty()) {
                Future<?> resolving = figiWorkers.submit(() -> resolveTickers(ask));
                try {
                    resolving.get(figiWaitMs, TimeUnit.MILLISECONDS);
                } catch (TimeoutException e) {
                    // Sigue en segundo plano: esta vez sin esos tickers, la próxima ya los tiene.
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (ExecutionException e) {
                    log.debug("No se pudieron completar los tickers: {}", e.getMessage());
                }
            }
        }
        return comp.withHoldings(comp.holdings().stream().map(h -> {
            if (h.ticker() != null || h.isin() == null) return h;
            String t = isinTicker.get(h.isin().toUpperCase(Locale.ROOT));
            return h.withTicker(t == null || t.isEmpty() ? null : t);
        }).toList());
    }

    /** Pregunta a OpenFIGI lo que aún no se sabe, de uno en uno entre todas las peticiones. */
    private void resolveTickers(List<String> isins) {
        figiLock.lock();
        try {
            List<String> ask = isins.stream().filter(i -> !isinTicker.containsKey(i)).toList();
            if (ask.isEmpty()) return;
            Map<String, String> found;
            try {
                found = figi.homeTickers(ask);
            } catch (RuntimeException e) {
                found = Map.of();
            }
            found.forEach((isin, ticker) -> {
                isinTicker.put(isin, ticker != null ? ticker : "");
                cache.save(ISIN_TICKER_KIND, isin, ticker);
            });
        } finally {
            figiLock.unlock();
        }
    }

    private static String text(JsonNode n) {
        return n != null && n.isString() && !n.asString().isEmpty() ? n.asString() : null;
    }
}
