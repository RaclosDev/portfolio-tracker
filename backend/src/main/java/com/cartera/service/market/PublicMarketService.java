package com.cartera.service.market;

import com.cartera.dto.market.Candle;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.dto.market.Quote;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Function;

/**
 * Cotizaciones reales para la portada y la demo, que se ven sin sesión: solo una lista cerrada de valores conocidos y
 * nada de ningún usuario. Se guarda unos minutos para que las visitas no lleguen a las fuentes.
 */
@Service
@RequiredArgsConstructor
public class PublicMarketService {

    /** Los de la portada (el mapa de precios). */
    public static final List<String> LANDING = List.of("IBE.MC", "MSFT", "VWCE.DE");
    /** Los de la demo: el mismo catálogo que frontend/src/demo/backend.ts. */
    public static final List<String> DEMO = List.of(
            "IBE.MC", "SAN.MC", "ITX.MC", "BBVA.MC", "REP.MC", "TEF.MC", "AENA.MC", "CABK.MC", "FER.MC", "AMS.MC",
            "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "BRK-B", "JPM", "LLY", "AVGO", "V", "KO",
            "VWCE.DE", "SXR8.DE");
    private static final long TTL_MS = 5 * 60_000;
    /** Las velas intradía de la demo se renuevan cada minuto: la última vela está viva. */
    private static final long INTRADAY_TTL_MS = 60_000;

    public record Snapshot(Map<String, Quote> quotes, Map<String, List<Candle>> candles, long fetchedAt) {}

    private record Intraday(List<Candle> candles, long fetchedAt) {}

    private final MarketService market;
    private volatile Snapshot landing;
    private volatile Snapshot demo;
    private final Map<String, Intraday> intraday = new ConcurrentHashMap<>();
    /*
     * ReentrantLock y no synchronized: las peticiones van en hilos virtuales y, en Java 21, uno que espera dentro de
     * synchronized deja bloqueado su hilo real. Con un solo procesador (Render) las tareas que espera no llegaban a
     * ejecutarse y la app entera se quedaba colgada.
     */
    private final ReentrantLock landingLock = new ReentrantLock();
    private final ReentrantLock demoLock = new ReentrantLock();

    /** Cotización y velas de 5 minutos de las últimas sesiones. */
    public Snapshot landing() {
        landingLock.lock();
        try {
            if (fresh(landing)) return landing;
            landing = build(LANDING, s -> market.getCandles(s, IntradayInterval.M5).candles());
            return landing;
        } finally {
            landingLock.unlock();
        }
    }

    /** Cotización y velas diarias de cinco años. */
    public Snapshot demo() {
        demoLock.lock();
        try {
            if (fresh(demo)) return demo;
            demo = build(DEMO, s -> market.getCandles(s, null).candles());
            return demo;
        } finally {
            demoLock.unlock();
        }
    }

    /** Velas intradía reales de un valor del catálogo de la demo; vacío si no es de la lista o no hay datos. */
    public List<Candle> demoIntraday(String symbol, IntradayInterval interval) {
        if (!DEMO.contains(symbol)) return List.of();
        String key = symbol + "|" + interval.id();
        Intraday cached = intraday.get(key);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt() < INTRADAY_TTL_MS) return cached.candles();
        List<Candle> candles = market.getCandles(symbol, interval).candles();
        List<Candle> list = candles == null ? List.of() : List.copyOf(candles);
        // Un fallo de la fuente no se guarda: la siguiente visita lo vuelve a intentar.
        if (!list.isEmpty()) intraday.put(key, new Intraday(list, System.currentTimeMillis()));
        return list;
    }

    private static boolean fresh(Snapshot s) {
        return s != null && !s.quotes().isEmpty() && System.currentTimeMillis() - s.fetchedAt() < TTL_MS;
    }

    private Snapshot build(List<String> symbols, Function<String, List<Candle>> candlesOf) {
        Map<String, Quote> quotes = new LinkedHashMap<>(market.getQuotes(symbols));
        Map<String, List<Candle>> candles = new LinkedHashMap<>();
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            Map<String, Future<List<Candle>>> pending = new LinkedHashMap<>();
            for (String s : symbols) pending.put(s, pool.submit(() -> candlesOf.apply(s)));
            for (var e : pending.entrySet()) {
                try {
                    List<Candle> list = e.getValue().get();
                    if (list != null && !list.isEmpty()) candles.put(e.getKey(), list);
                } catch (Exception ignored) {
                    // Sin velas de ese valor: la demo usa las suyas.
                    if (Thread.currentThread().isInterrupted()) break;
                }
            }
        }
        quotes.values().removeIf(q -> q == null || q.price() == null);
        return new Snapshot(Map.copyOf(quotes), Map.copyOf(candles), System.currentTimeMillis());
    }
}
