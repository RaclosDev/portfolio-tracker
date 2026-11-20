package com.cartera.service.portfolio;

import com.cartera.dto.market.DailyHistoryResult;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.portfolio.PortfolioDtos.HistoryPoint;
import com.cartera.model.Instrument;
import com.cartera.model.Operation;
import com.cartera.model.OperationType;
import com.cartera.util.Money;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Valor de la cartera día a día: acciones de cada valor en cada fecha por su cierre, en euros al cambio de ese día
 * y al del inicio (para separar el efecto divisa). Mismo cálculo que el del cliente.
 */
public final class PortfolioHistoryCalculator {

    /** Un cierre más antiguo que esto no vale para la fecha: el valor está suspendido o falta el dato. */
    private static final long MAX_PRICE_AGE_DAYS = 7;

    private PortfolioHistoryCalculator() {
    }

    /** Lee cierres en fechas crecientes, sin mirar al futuro. */
    private static final class Reader {
        private final List<LocalDate> dates = new ArrayList<>();
        private final List<Double> closes = new ArrayList<>();
        private int cursor = -1;

        Reader(List<PricePoint> points) {
            points.stream()
                    .filter(p -> Double.isFinite(p.c()) && p.c() > 0)
                    .map(p -> Map.entry(LocalDate.parse(p.t().substring(0, 10)), p.c()))
                    .sorted(Map.Entry.comparingByKey())
                    .forEach(e -> {
                        dates.add(e.getKey());
                        closes.add(e.getValue());
                    });
        }

        Double at(LocalDate date, LocalDate notBefore) {
            while (cursor + 1 < dates.size() && !dates.get(cursor + 1).isAfter(date)) cursor++;
            if (cursor < 0) return null;
            LocalDate d = dates.get(cursor);
            if (notBefore != null && d.isBefore(notBefore)) return null;
            return ChronoUnit.DAYS.between(d, date) <= MAX_PRICE_AGE_DAYS ? closes.get(cursor) : null;
        }
    }

    public static List<HistoryPoint> compute(List<Operation> operations, List<Instrument> instruments,
                                             Map<String, DailyHistoryResult> prices,
                                             Map<String, List<PricePoint>> fx, LocalDate from, LocalDate to) {
        Map<String, Instrument> byTicker = new HashMap<>();
        instruments.forEach(i -> byTicker.put(i.getTicker(), i));
        List<Operation> ops = Ledger.sorted(operations);
        Map<Long, Double> income = Ledger.compute(ops, instruments).income();
        Map<String, Reader> priceReaders = mapValues(prices, h -> new Reader(h.points()));
        Map<String, Reader> fxReaders = mapValues(fx, Reader::new);
        Map<String, Double> fixedFx = new HashMap<>();
        fx.forEach((currency, series) -> fixedFx.put(currency, new Reader(series).at(from, null)));

        Map<String, Double> shares = new LinkedHashMap<>();
        Map<String, LocalDate> lastSplit = new HashMap<>();
        Map<String, Double> transfers = new LinkedHashMap<>();
        List<HistoryPoint> points = new ArrayList<>();
        int cursor = 0;
        Double startingValue = null;
        List<String> startingMissing = List.of();
        double purchases = 0;
        double sales = 0;
        double incomeEur = 0;

        for (LocalDate date = from.minusDays(1); !date.isAfter(to); date = date.plusDays(1)) {
            while (cursor < ops.size() && !ops.get(cursor).getDate().isAfter(date)) {
                Operation op = ops.get(cursor++);
                double held = shares.getOrDefault(op.getTicker(), 0.0);
                double opShares = op.getShares() == null ? 0 : op.getShares();
                OperationType type = op.getType();
                if (!op.getDate().isBefore(from)) {
                    if (type == OperationType.BUY) purchases += op.getAmountEur();
                    else if (type == OperationType.SELL) sales += op.getAmountEur();
                    else incomeEur += income.getOrDefault(op.getId(), 0.0);
                }
                if (type == OperationType.TRANSFER_OUT && op.getTransferRef() != null) {
                    transfers.put(op.getTransferRef(), op.getAmountEur());
                }
                if (type == OperationType.TRANSFER_IN && op.getTransferRef() != null) {
                    transfers.remove(op.getTransferRef());
                }
                switch (type) {
                    case BUY, SCRIP, TRANSFER_IN -> shares.put(op.getTicker(), held + opShares);
                    case SELL, TRANSFER_OUT -> shares.put(op.getTicker(), held - opShares);
                    case SPLIT -> {
                        shares.put(op.getTicker(), held * (op.getSplitRatio() == null ? 1 : op.getSplitRatio()));
                        lastSplit.put(op.getTicker(), op.getDate());
                    }
                    default -> {
                    }
                }
            }

            // Lo que está en camino entre dos fondos cuenta por su importe hasta que llega.
            double value = transfers.values().stream().mapToDouble(Double::doubleValue).sum();
            double constant = value;
            boolean missingPrice = false;
            boolean missingFx = false;
            boolean missingFixedFx = false;
            Set<String> missing = new LinkedHashSet<>();
            for (Map.Entry<String, Double> e : shares.entrySet()) {
                String ticker = e.getKey();
                double held = e.getValue();
                if (held <= 1e-6) continue;
                Instrument instrument = byTicker.get(ticker);
                String symbol = instrument == null ? null : instrument.getSymbol();
                Reader reader = symbol == null ? null : priceReaders.get(symbol);
                Double price = reader == null ? null : reader.at(date, lastSplit.get(ticker));
                DailyHistoryResult history = symbol == null ? null : prices.get(symbol);
                String currency = history != null && history.currency() != null ? history.currency()
                        : instrument == null ? null : instrument.getCurrency();
                if (price == null || currency == null) {
                    missingPrice = true;
                    missing.add(ticker);
                    continue;
                }
                Double rate = "EUR".equals(currency) ? Double.valueOf(1)
                        : fxReaders.containsKey(currency) ? fxReaders.get(currency).at(date, null) : null;
                Double fixed = "EUR".equals(currency) ? Double.valueOf(1) : fixedFx.get(currency);
                if (rate == null) {
                    missingFx = true;
                    missing.add("EUR/" + currency);
                } else {
                    value += Money.cents(held * price / rate);
                }
                if (fixed == null) {
                    missingFixedFx = true;
                    missing.add("EUR/" + currency + " al inicio");
                } else {
                    constant += Money.cents(held * price / fixed);
                }
            }
            // En céntimos, posición a posición, como la valoración de hoy: el resultado cuadra con las cifras que se ven.
            Double valueEur = missingPrice || missingFx ? null : Money.cents(value);
            Double constantFxEur = missingPrice || missingFixedFx ? null : Money.cents(constant);
            if (date.isBefore(from)) {
                startingValue = valueEur;
                if (valueEur == null) startingMissing = missing.stream().map(s -> s + " al cierre previo").toList();
                continue;
            }
            Set<String> allMissing = new LinkedHashSet<>(missing);
            allMissing.addAll(startingMissing);
            points.add(new HistoryPoint(date.toString(), valueEur, constantFxEur,
                    valueEur != null && constantFxEur != null ? Money.cents(valueEur - constantFxEur) : null,
                    startingValue,
                    valueEur != null && startingValue != null
                            ? Money.cents(valueEur - startingValue - purchases + sales + incomeEur) : null,
                    Money.cents(purchases), Money.cents(sales), Money.cents(incomeEur), List.copyOf(allMissing)));
        }
        return points;
    }

    private static <T> Map<String, Reader> mapValues(Map<String, T> in, Function<T, Reader> f) {
        Map<String, Reader> out = new HashMap<>();
        in.forEach((k, v) -> out.put(k, f.apply(v)));
        return out;
    }
}
