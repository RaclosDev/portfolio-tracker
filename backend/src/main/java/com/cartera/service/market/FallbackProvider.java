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
import com.cartera.util.Isin;
import lombok.extern.slf4j.Slf4j;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Prueba las fuentes en orden hasta que una responde. Las pausas pertenecen a cada fuente: un 429 de Yahoo no
 * bloquea las alternativas.
 */
@Slf4j
public class FallbackProvider implements MarketDataProvider {

    private static final long FIRST_BACKOFF_MS = 30_000;
    private static final long MAX_BACKOFF_MS = 15 * 60_000;
    private static final long OUTAGE_PAUSE_MS = 60_000;

    private record Pause(long until, long backoff) {
    }

    /** Resultado de llamar a una fuente: {@code ok=false} si falló o está en pausa. */
    private record Call<T>(boolean ok, T value) {
    }

    private final List<MarketDataProvider> providers;
    private final String id;
    private final Map<String, Pause> pauses = new ConcurrentHashMap<>();
    private final Map<String, SourceError> lastErrors = new ConcurrentHashMap<>();

    public FallbackProvider(List<MarketDataProvider> providers) {
        this.providers = List.copyOf(providers);
        this.id = providers.stream().map(MarketDataProvider::id).collect(Collectors.joining("+"));
    }

    /** Yahoo no usa «:» en sus tickers: BORSA:…, XETRA:… y los ISIN son de las otras fuentes. */
    private static boolean notYahoo(String symbol) {
        return symbol.contains(":") || Isin.isIsin(symbol);
    }

    private static boolean skip(MarketDataProvider p, String symbol) {
        return p.id().equals("yahoo") && notYahoo(symbol);
    }

    @Override
    public String id() {
        return id;
    }

    private <T> Call<T> call(MarketDataProvider provider, Supplier<T> run) {
        Pause pause = pauses.get(provider.id());
        if (pause != null && pause.until() > System.currentTimeMillis()) return new Call<>(false, null);
        try {
            T result = run.get();
            if (pause != null) pauses.remove(provider.id(), pause);
            return new Call<>(true, result);
        } catch (RuntimeException error) {
            boolean rateLimited = MarketSourceException.isRateLimit(error);
            long backoff = rateLimited
                    ? Math.min((pause != null ? pause.backoff() : FIRST_BACKOFF_MS) * 2, MAX_BACKOFF_MS)
                    : OUTAGE_PAUSE_MS;
            // Un símbolo inexistente no debe pausar los demás valores del proveedor.
            if (rateLimited || MarketSourceException.isOutage(error)) {
                pauses.put(provider.id(), new Pause(System.currentTimeMillis() + backoff, backoff));
            }
            lastErrors.put(provider.id(), new SourceError(YahooProvider.ISO_MS.format(Instant.now()), MarketSourceException.summary(error)));
            log.debug("No responde {}; se prueban las demás fuentes: {}", provider.id(), error.getMessage());
            return new Call<>(false, null);
        }
    }

    @Override
    public Map<String, Object> diagnostics() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (MarketDataProvider p : providers) {
            Map<String, Object> d = new LinkedHashMap<>(p.diagnostics());
            Pause pause = pauses.get(p.id());
            d.put("pausedUntil", pause != null && pause.until() > System.currentTimeMillis()
                    ? YahooProvider.ISO_MS.format(Instant.ofEpochMilli(pause.until())) : null);
            d.put("lastError", lastErrors.get(p.id()));
            out.put(p.id(), d);
        }
        return out;
    }

    @Override
    public List<Quote> getQuotes(List<String> symbols) {
        Set<String> missing = new LinkedHashSet<>();
        for (String s : symbols) missing.add(s.toUpperCase(Locale.ROOT));
        List<Quote> results = new ArrayList<>();
        for (MarketDataProvider provider : providers) {
            if (missing.isEmpty()) break;
            // Yahoo cotiza con sus tickers; los ISIN se resuelven a esos tickers en la búsqueda.
            List<String> requested = missing.stream().filter(s -> !skip(provider, s)).toList();
            if (requested.isEmpty()) continue;
            Call<List<Quote>> quotes = call(provider, () -> provider.getQuotes(requested));
            if (quotes.value() == null) continue;
            for (Quote quote : quotes.value()) {
                String symbol = quote.symbol().toUpperCase(Locale.ROOT);
                if (!missing.contains(symbol) || quote.price() == null || !Double.isFinite(quote.price())
                        || quote.price() <= 0 || quote.currency() == null) continue;
                results.add(quote.withSymbol(symbol));
                missing.remove(symbol);
            }
        }
        return results;
    }

    private <T> T first(String symbol, Function<MarketDataProvider, T> run, Predicate<T> valid) {
        boolean failed = false;
        for (MarketDataProvider provider : providers) {
            if (skip(provider, symbol)) continue;
            Call<T> result = call(provider, () -> run.apply(provider));
            if (!result.ok()) failed = true;
            if (result.value() != null && valid.test(result.value())) return result.value();
        }
        if (failed) throw new MarketSourceException("Las fuentes disponibles no han podido completar la consulta");
        return null;
    }

    @Override
    public AnalystTargets getTargets(String symbol) {
        return first(symbol, p -> p.getTargets(symbol), t -> true);
    }

    @Override
    public CompanyProfile getProfile(String symbol) {
        return first(symbol, p -> p.getProfile(symbol), t -> true);
    }

    @Override
    public List<PricePoint> getHistory(String symbol, HistoryRange range) {
        List<PricePoint> out = first(symbol, p -> p.getHistory(symbol, range), points -> !points.isEmpty());
        return out != null ? out : List.of();
    }

    @Override
    public DailyHistory getDailyHistory(String symbol, LocalDate from) {
        DailyHistory out = first(symbol, p -> p.getDailyHistory(symbol, from), d -> !d.points().isEmpty());
        return out != null ? out : DailyHistory.EMPTY;
    }

    @Override
    public List<Candle> getCandles(String symbol, LocalDate from) {
        List<Candle> out = first(symbol, p -> p.getCandles(symbol, from), c -> !c.isEmpty());
        return out != null ? out : List.of();
    }

    @Override
    public List<Candle> getIntradayCandles(String symbol, IntradayInterval interval) {
        List<Candle> out = first(symbol, p -> p.getIntradayCandles(symbol, interval), c -> !c.isEmpty());
        return out != null ? out : List.of();
    }

    @Override
    public List<SymbolSearchResult> search(String query) {
        Map<String, SymbolSearchResult> results = new LinkedHashMap<>();
        for (MarketDataProvider provider : providers) {
            if (provider.id().equals("yahoo") && query.contains(":")) continue;
            Call<List<SymbolSearchResult>> found = call(provider, () -> provider.search(query));
            if (found.value() == null) continue;
            for (SymbolSearchResult r : found.value()) results.putIfAbsent(r.symbol(), r);
        }
        return new ArrayList<>(results.values());
    }
}
