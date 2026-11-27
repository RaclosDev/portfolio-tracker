package com.cartera.service.portfolio;

import com.cartera.model.Instrument;
import com.cartera.model.Operation;
import com.cartera.util.Money;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Recorrido del registro de operaciones en el servidor: acciones de cada posición, cobros y lo que no cuadra.
 * <p>Los cálculos completos (lotes FIFO, plusvalías, regla de los dos meses, Renta) los hace el cliente. Aquí solo
 * se necesita saber qué sigue en cartera y que el registro sea coherente antes de guardarlo, con las mismas reglas
 * y los mismos mensajes que el motor del cliente.
 * <p>Identidad del valor: el ISIN. Los tickers con el mismo ISIN (un ETF comprado en dos bolsas) forman una sola
 * posición.
 */
public final class Ledger {

    private static final double EPS = 1e-6;

    /** Una posición: el ticker canónico de su ISIN (o el suyo) y los tickers del registro que la forman. */
    public record Position(String ticker, String isin, List<String> members, double shares) {
        public boolean open() {
            return shares > 1e-9;
        }
    }

    public record Issue(long opId, String ticker, LocalDate date, String message) {
    }

    private record Identity(String key, String isin) {
    }

    private static final class State {
        final String key;
        final String isin;
        final TreeSet<String> members = new TreeSet<>();
        double shares;

        State(String key, String isin) {
            this.key = key;
            this.isin = isin;
        }
    }

    private static final class Transfer {
        final Operation operation;
        boolean received;

        Transfer(Operation operation) {
            this.operation = operation;
        }
    }

    private final List<Position> positions;
    private final Map<String, Position> byTicker;
    private final List<Issue> issues;
    private final Map<Long, Double> income;

    private Ledger(List<Position> positions, List<Issue> issues, Map<Long, Double> income) {
        this.positions = positions;
        this.issues = issues;
        this.income = income;
        Map<String, Position> map = new HashMap<>();
        for (Position p : positions) {
            map.put(p.ticker(), p);
            p.members().forEach(m -> map.put(m, p));
        }
        this.byTicker = map;
    }

    public List<Position> positions() {
        return positions;
    }

    /** Posición de un ticker, también de los que se agrupan en otro por compartir ISIN. */
    public Position position(String ticker) {
        return byTicker.get(ticker);
    }

    public List<Issue> issues() {
        return issues;
    }

    /** Lo ganado con cada cobro (bruto − comisiones − retención extranjera), por id de la operación. */
    public Map<Long, Double> income() {
        return income;
    }

    /**
     * Orden de proceso: fecha; el mismo día, primero las que tienen «orden del día» y en ese orden; después las
     * que no lo tienen: compras antes que ventas y, a igualdad, por orden de alta.
     */
    public static final Comparator<Operation> PROCESS_ORDER = Comparator.comparing(Operation::getDate)
            .thenComparing(o -> o.getDayOrder() == null ? Integer.MAX_VALUE : o.getDayOrder())
            .thenComparingInt(o -> o.getType().rank())
            .thenComparing(Operation::getId);

    public static List<Operation> sorted(List<Operation> operations) {
        return operations.stream().sorted(PROCESS_ORDER).toList();
    }

    public static Ledger compute(List<Operation> operations, List<Instrument> instruments) {
        Map<String, Identity> identity = identityByTicker(instruments);
        Map<String, State> states = new LinkedHashMap<>();
        Map<String, Transfer> transfers = new HashMap<>();
        List<Issue> issues = new ArrayList<>();
        Map<Long, Double> income = new HashMap<>();

        for (Operation op : sorted(operations)) {
            Identity id = identity.get(op.getTicker());
            String key = id != null ? id.key() : op.getTicker();
            State st = states.computeIfAbsent(key, k -> new State(k, id != null ? id.isin() : null));
            st.members.add(op.getTicker());
            double shares = op.getShares() == null ? 0 : op.getShares();
            switch (op.getType()) {
                case TRANSFER_OUT -> {
                    String ref = op.getTransferRef();
                    if (ref == null || transfers.containsKey(ref)) {
                        issues.add(issue(op, "La salida necesita una referencia de traspaso única."));
                    } else if (shares > st.shares + EPS) {
                        issues.add(issue(op, "El traspaso supera las participaciones disponibles."));
                    } else {
                        st.shares = clamp(st.shares - shares);
                        transfers.put(ref, new Transfer(op));
                    }
                }
                case TRANSFER_IN -> {
                    Transfer transfer = op.getTransferRef() == null ? null : transfers.get(op.getTransferRef());
                    if (transfer == null || transfer.received) {
                        issues.add(issue(op, "Falta una salida anterior disponible con la misma referencia de traspaso."));
                        break;
                    }
                    Identity from = identity.get(transfer.operation.getTicker());
                    String fromKey = from != null ? from.key() : transfer.operation.getTicker();
                    if (fromKey.equals(key) || Math.abs(transfer.operation.getAmountEur() - op.getAmountEur()) > 0.005) {
                        issues.add(issue(op, "El traspaso debe enlazar fondos distintos con el mismo importe."));
                        break;
                    }
                    st.shares += shares;
                    transfer.received = true;
                }
                case BUY, SCRIP -> st.shares += shares;
                case SPLIT -> st.shares *= op.getSplitRatio() == null ? 1 : op.getSplitRatio();
                case SELL -> {
                    double want = shares;
                    if (want > st.shares + EPS) {
                        issues.add(issue(op, "Se venden " + Money.format(want) + " acciones pero solo hay "
                                + Money.format(st.shares) + "."));
                        want = st.shares;
                    }
                    st.shares = clamp(st.shares - want);
                }
                default -> {
                    if (op.getType().isIncome()) income.put(op.getId(), incomeEur(op));
                }
            }
        }

        List<Position> positions = states.values().stream()
                .map(s -> new Position(s.key, s.isin, List.copyOf(s.members), s.shares <= EPS ? 0 : s.shares))
                .toList();
        return new Ledger(positions, issues, income);
    }

    /** Lo que se gana con un cobro a efectos de la rentabilidad: bruto − comisiones − retención extranjera. */
    static double incomeEur(Operation op) {
        double fx = op.getFxRate() == 0 ? 1 : op.getFxRate();
        double feesEur = Money.cents(op.getFees() / fx);
        double base = Money.cents(op.getAmountEur() - feesEur);
        return Money.cents(base - (op.getWithholdingForeign() == null ? 0 : op.getWithholdingForeign()));
    }

    /**
     * Ticker canónico de cada ticker con ISIN: el mismo para todos los que comparten ISIN. Se prefiere el que tiene
     * símbolo de cotización y, a igualdad, el primero por orden alfabético. Los tickers sin ISIN no aparecen.
     */
    private static Map<String, Identity> identityByTicker(List<Instrument> instruments) {
        Map<String, List<Instrument>> groups = new LinkedHashMap<>();
        for (Instrument i : instruments) {
            String isin = normIsin(i.getIsin());
            if (isin != null) groups.computeIfAbsent(isin, k -> new ArrayList<>()).add(i);
        }
        Map<String, Identity> out = new HashMap<>();
        groups.forEach((isin, list) -> {
            String key = list.stream()
                    .sorted(Comparator.comparing((Instrument i) -> i.getSymbol() == null || i.getSymbol().isEmpty())
                            .thenComparing(Instrument::getTicker))
                    .findFirst().orElseThrow().getTicker();
            list.forEach(i -> out.put(i.getTicker(), new Identity(key, isin)));
        });
        return out;
    }

    /** Ticker canónico de cada ticker (el suyo si no tiene ISIN): los que comparten ISIN dan el mismo. */
    static Map<String, String> canonicalTickers(List<Instrument> instruments) {
        Map<String, String> out = new HashMap<>();
        identityByTicker(instruments).forEach((ticker, id) -> out.put(ticker, id.key()));
        return out;
    }

    private static String normIsin(String isin) {
        if (isin == null) return null;
        String v = isin.trim().toUpperCase();
        return v.length() == 12 ? v : null;
    }

    private static double clamp(double shares) {
        return shares <= EPS ? 0 : shares;
    }

    private static Issue issue(Operation op, String message) {
        return new Issue(op.getId(), op.getTicker(), op.getDate(), message);
    }
}
