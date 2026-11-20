package com.cartera.service.portfolio;

import com.cartera.dto.market.CompanyProfile;
import com.cartera.dto.market.DailyHistoryResult;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.portfolio.InstrumentResponse;
import com.cartera.dto.portfolio.OperationResponse;
import com.cartera.dto.portfolio.PortfolioDtos.AvailableHistory;
import com.cartera.dto.portfolio.PortfolioDtos.CarteraView;
import com.cartera.dto.portfolio.PortfolioDtos.ExcludedInstrument;
import com.cartera.dto.portfolio.PortfolioDtos.HistoryPoint;
import com.cartera.dto.portfolio.PortfolioDtos.PortfolioHistory;
import com.cartera.exception.ApiException;
import com.cartera.model.Instrument;
import com.cartera.model.Operation;
import com.cartera.model.OperationType;
import com.cartera.repository.InstrumentRepository;
import com.cartera.repository.OperationRepository;
import com.cartera.service.market.MarketService;
import com.cartera.service.market.MarketService.MinorUnit;
import com.cartera.service.market.YahooProvider;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.stream.Stream;

/**
 * Cartera real: el registro de operaciones y los precios de hoy. Los cálculos (FIFO, plusvalías, Renta) los hace el
 * cliente; el servidor da los datos, el histórico de valor y valida que el registro siga cuadrando antes de guardar.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PortfolioService {

    /** Fichas pedidas a Yahoo en cada carga como mucho (el resto, en las siguientes). */
    private static final int PROFILES_PER_VIEW = 8;
    /** Un valor sin sector o nombre en Yahoo se vuelve a pedir como pronto al día siguiente. */
    private static final long PROFILE_RETRY_MS = 24 * 3_600_000L;
    private static final int MAX_PROFILE_MEMORY = 5000;
    private static final ZoneId MADRID = ZoneId.of("Europe/Madrid");

    private final OperationRepository operations;
    private final InstrumentRepository instruments;
    private final MarketService market;

    private final Set<UUID> profilesRunning = ConcurrentHashMap.newKeySet();
    /** Cuándo se pidió la ficha de cada valor: los que Yahoo no completa no bloquean a los siguientes. */
    private final Map<String, Long> profileTried = new ConcurrentHashMap<>();

    /** Antigüedad máxima normal de los precios de la cartera. */
    public long defaultMaxAgeMs() {
        return market.quoteTtlMs();
    }

    /** {@code maxAgeMs}: antigüedad máxima de los precios (más corta con la cartera en pantalla). */
    public CarteraView view(UUID userId, boolean force, long maxAgeMs) {
        List<Operation> ops = operations.findAllOrdered(userId);
        List<Instrument> all = instruments.findByUserIdOrderByTicker(userId);
        // Precio solo de lo que sigue en cartera; de una posición con varios tickers (mismo ISIN), todos ellos.
        Set<String> open = openTickers(Ledger.compute(ops, all));
        List<Instrument> held = all.stream().filter(i -> open.contains(i.getTicker())).toList();
        List<String> symbols = held.stream().map(Instrument::getSymbol).filter(Objects::nonNull).distinct().toList();
        Map<String, Quote> quotes = market.getQuotes(symbols, force, maxAgeMs);
        // La cartera va siempre en euros (costes, Renta): no depende de la divisa base de la lista.
        Set<String> fxStale = new LinkedHashSet<>();
        List<String> currencies = Stream.concat(quotes.values().stream().map(Quote::currency),
                held.stream().map(Instrument::getCurrency)).filter(Objects::nonNull).distinct().toList();
        Map<String, Double> fx = market.getFxRates("EUR", currencies, null, fxStale);

        List<Instrument> profileOrder = new ArrayList<>(held);
        all.stream().filter(i -> !open.contains(i.getTicker())).forEach(profileOrder::add);
        fillProfilesInBackground(userId, profileOrder);

        return new CarteraView(all.stream().map(InstrumentResponse::of).toList(),
                ops.stream().map(OperationResponse::of).toList(), new LinkedHashMap<>(quotes), fx,
                List.copyOf(fxStale), YahooProvider.ISO_MS.format(Instant.now()), market.throttledUntilIso());
    }

    public PortfolioHistory history(UUID userId, LocalDate from, LocalDate to) {
        if (from.isBefore(LocalDate.of(1900, 1, 1))) throw ApiException.badRequest("La fecha debe ser posterior a 1900");
        if (from.isAfter(to)) throw ApiException.badRequest("La fecha inicial debe ser anterior a la final");
        if (from.plusDays(100 * 366).isBefore(to)) throw ApiException.badRequest("El periodo máximo es de 100 años");
        if (to.isAfter(LocalDate.now(MADRID))) {
            throw ApiException.badRequest("El histórico no admite fechas futuras");
        }

        List<Operation> ops = operations.findAllOrdered(userId);
        List<Instrument> all = instruments.findByUserIdOrderByTicker(userId);
        List<Operation> before = ops.stream().filter(o -> o.getDate().isBefore(from)).toList();
        Set<String> relevant = new HashSet<>();
        Ledger.compute(before, all).positions().stream().filter(p -> p.shares() > 1e-6)
                .forEach(p -> {
                    relevant.add(p.ticker());
                    relevant.addAll(p.members());
                });
        for (Operation o : ops) {
            boolean inRange = !o.getDate().isBefore(from) && !o.getDate().isAfter(to);
            if (inRange && (o.getType() == OperationType.BUY || o.getType() == OperationType.SCRIP
                    || o.getType() == OperationType.TRANSFER_IN)) {
                relevant.add(o.getTicker());
            }
        }
        List<Instrument> selected = all.stream().filter(i -> relevant.contains(i.getTicker())).toList();

        Map<String, DailyHistoryResult> prices = new ConcurrentHashMap<>();
        List<String> symbols = selected.stream().map(Instrument::getSymbol).filter(Objects::nonNull).distinct().toList();
        LocalDate start = from.minusDays(1);
        // Dos peticiones como máximo a la vez: una cartera importada puede tener cientos de valores.
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < symbols.size(); i += 2) {
                List<String> batch = symbols.subList(i, Math.min(i + 2, symbols.size()));
                batch.stream().map(s -> pool.submit(() -> prices.put(s, market.getDailyHistory(s, start))))
                        .toList().forEach(PortfolioService::await);
            }
        }
        boolean stale = prices.values().stream().anyMatch(DailyHistoryResult::stale);

        Map<String, List<PricePoint>> fx = new LinkedHashMap<>();
        List<String> currencies = selected.stream().map(i -> currencyOf(i, prices)).distinct().toList();
        for (String currency : currencies) {
            if ("EUR".equals(currency)) continue;
            MinorUnit unit = MarketService.MINOR_UNITS.getOrDefault(currency, new MinorUnit(currency, 1));
            DailyHistoryResult h = market.getDailyHistory("EUR" + unit.major() + "=X", start);
            fx.put(currency, h.points().stream().map(p -> new PricePoint(p.t(), p.c() * unit.factor())).toList());
            stale |= h.stale();
        }

        List<HistoryPoint> points = PortfolioHistoryCalculator.compute(ops, all, prices, fx, from, to);

        LocalDate earliest = from.minusDays(8);
        Set<String> excluded = new HashSet<>();
        for (Instrument i : selected) {
            DailyHistoryResult h = i.getSymbol() == null ? null : prices.get(i.getSymbol());
            String currency = currencyOf(i, prices);
            if (!hasPrices(h == null ? null : h.points(), earliest, to)
                    || (!"EUR".equals(currency) && !hasPrices(fx.get(currency), earliest, to))) {
                excluded.add(i.getTicker());
            }
        }
        // Un histórico parcial debe excluir toda la cadena de fondos enlazados por traspasos.
        boolean changed = true;
        while (changed) {
            changed = false;
            Set<String> refs = new HashSet<>();
            ops.stream().filter(o -> excluded.contains(o.getTicker()) && o.getTransferRef() != null)
                    .forEach(o -> refs.add(o.getTransferRef()));
            for (Operation o : ops) {
                if (o.getTransferRef() != null && refs.contains(o.getTransferRef()) && excluded.add(o.getTicker())) {
                    changed = true;
                }
            }
        }
        List<Instrument> excludedLinked = selected.stream().filter(i -> excluded.contains(i.getTicker())).toList();
        AvailableHistory available = null;
        if (!excludedLinked.isEmpty() && excludedLinked.size() < selected.size()) {
            List<HistoryPoint> partial = PortfolioHistoryCalculator.compute(
                    ops.stream().filter(o -> !excluded.contains(o.getTicker())).toList(),
                    all.stream().filter(i -> !excluded.contains(i.getTicker())).toList(), prices, fx, from, to);
            available = new AvailableHistory(partial, selected.size() - excludedLinked.size(),
                    excludedLinked.stream().map(i -> new ExcludedInstrument(i.getTicker(),
                            i.getName() == null || i.getName().isEmpty() ? i.getTicker() : i.getName())).toList());
        }
        List<String> missing = points.stream().flatMap(p -> p.missing().stream()).distinct().toList();
        return new PortfolioHistory(from.toString(), to.toString(), points, stale, missing, available);
    }

    /** Lanza un error 400 si el registro no cuadra (se vende más de lo que hay…). */
    public static void assertValid(List<Operation> operations, List<Instrument> instruments) {
        List<Ledger.Issue> issues = Ledger.compute(operations, instruments).issues();
        if (!issues.isEmpty()) {
            throw ApiException.badRequest(String.join(" ", issues.stream().map(Ledger.Issue::message).toList()));
        }
    }

    static Set<String> openTickers(Ledger ledger) {
        Set<String> open = new HashSet<>();
        ledger.positions().stream().filter(Ledger.Position::open).forEach(p -> {
            open.add(p.ticker());
            open.addAll(p.members());
        });
        return open;
    }

    private static String currencyOf(Instrument i, Map<String, DailyHistoryResult> prices) {
        DailyHistoryResult h = i.getSymbol() == null ? null : prices.get(i.getSymbol());
        return h != null && h.currency() != null ? h.currency() : i.getCurrency();
    }

    private static boolean hasPrices(List<PricePoint> series, LocalDate from, LocalDate to) {
        if (series == null) return false;
        String lo = from.toString();
        String hi = to.toString();
        return series.stream().anyMatch(p -> {
            String d = p.t().substring(0, 10);
            return Double.isFinite(p.c()) && p.c() > 0 && d.compareTo(lo) >= 0 && d.compareTo(hi) <= 0;
        });
    }

    /** Sector y nombre desde Yahoo para los valores que no los tienen (en segundo plano, poco a poco). */
    private void fillProfilesInBackground(UUID userId, List<Instrument> candidates) {
        long now = System.currentTimeMillis();
        List<Instrument> pending = candidates.stream()
                .filter(i -> i.getSymbol() != null && (isBlank(i.getSector()) || isBlank(i.getName())))
                .filter(i -> now - profileTried.getOrDefault(userId + ":" + i.getTicker(), 0L) > PROFILE_RETRY_MS)
                .limit(PROFILES_PER_VIEW)
                .toList();
        if (pending.isEmpty() || !profilesRunning.add(userId)) return;
        Thread.ofVirtual().name("fichas-" + userId).start(() -> {
            try {
                for (Instrument i : pending) {
                    if (profileTried.size() >= MAX_PROFILE_MEMORY) profileTried.clear();
                    profileTried.put(userId + ":" + i.getTicker(), now);
                    CompanyProfile p = market.getProfile(i.getSymbol());
                    if (p != null) instruments.fillProfile(userId, i.getTicker(), p.sector(), p.name(), Instant.now());
                }
            } catch (RuntimeException e) {
                // Sin ficha no pasa nada: se intentará en otra carga.
                log.debug("Fichas de la cartera sin completar: {}", e.getMessage());
            } finally {
                profilesRunning.remove(userId);
            }
        });
    }

    private static boolean isBlank(String s) {
        return s == null || s.isEmpty();
    }

    private static void await(java.util.concurrent.Future<?> f) {
        try {
            f.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        } catch (java.util.concurrent.ExecutionException e) {
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw new IllegalStateException(e.getCause());
        }
    }
}
