package com.cartera.service.alerts;

import com.cartera.dto.ItemRequest;
import com.cartera.dto.ItemResponse;
import com.cartera.dto.WatchlistView.LevelStatus;
import com.cartera.dto.WatchlistView.LevelView;
import com.cartera.dto.WatchlistView.Row;
import com.cartera.dto.alerts.AlertDtos.Alert;
import com.cartera.dto.alerts.AlertDtos.AlertKind;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/** Reglas de los avisos: qué avisar en cada comprobación y el texto del resumen diario. Sin estado. */
public final class AlertRules {

    /** No se repite el mismo aviso antes de este tiempo aunque el precio oscile en el límite. */
    static final Duration COOLDOWN = Duration.ofHours(12);

    private static final Locale ES = Locale.forLanguageTag("es-ES");
    private static final DateTimeFormatter ISO =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private AlertRules() {
    }

    /**
     * Lo que se recuerda entre comprobaciones: el último estado visto de cada nivel, cuándo se avisó de cada cosa
     * y con qué tramos se calcularon los estados.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Memory(Map<String, String> levels, Map<String, String> notified, String bands) {
        public Memory {
            levels = levels == null ? new LinkedHashMap<>() : new LinkedHashMap<>(levels);
            notified = notified == null ? new LinkedHashMap<>() : new LinkedHashMap<>(notified);
        }

        Memory withBands(String bands) {
            return new Memory(levels, notified, bands);
        }
    }

    public record Prefs(boolean reached, boolean near, boolean orders) {
    }

    public record Evaluation(List<Alert> alerts, Memory memory) {
    }

    public record Summary(String title, String body) {
    }

    /** ¿Están silenciados los avisos de este valor hoy? ({@code mutedUntil} incluido) */
    public static boolean isMuted(String mutedUntil, LocalDate today) {
        if (mutedUntil == null) return false;
        return mutedUntil.equals(ItemRequest.MUTED_FOREVER) || mutedUntil.compareTo(today.toString()) >= 0;
    }

    /** ¿Está la hora dentro del tramo [from, to)? Admite tramos que cruzan la medianoche. */
    public static boolean inTimeRange(String hhmm, String from, String to) {
        if (from.equals(to)) return false;
        return from.compareTo(to) < 0
                ? hhmm.compareTo(from) >= 0 && hhmm.compareTo(to) < 0
                : hhmm.compareTo(from) >= 0 || hhmm.compareTo(to) < 0;
    }

    public static String hhmm(LocalTime t) {
        return "%02d:%02d".formatted(t.getHour(), t.getMinute());
    }

    public static String iso(Instant at) {
        return ISO.format(at);
    }

    /**
     * Compara el estado actual con el recordado y devuelve los avisos nuevos.
     * Solo avisa cuando algo empeora hacia la compra (lejos → cerca → en zona), una vez.
     */
    public static Evaluation evaluate(List<Row> rows, Memory memory, Prefs prefs, Instant now) {
        Map<String, String> levels = new LinkedHashMap<>(memory.levels());
        Map<String, String> notified = new LinkedHashMap<>(memory.notified());
        List<Alert> alerts = new ArrayList<>();
        Map<Long, String> symbols = new HashMap<>();
        rows.forEach(r -> symbols.putIfAbsent(r.item().id(), r.item().symbol()));
        String nowIso = iso(now);
        Function<String, Boolean> recently = key -> {
            String at = notified.get(key);
            return at != null && Duration.between(Instant.parse(at), now).compareTo(COOLDOWN) < 0;
        };
        record Pending(String key, AlertKind kind, long itemId, String title, String body) {
        }
        java.util.function.Consumer<Pending> push = p -> {
            notified.put(p.key(), nowIso);
            alerts.add(new Alert(p.kind(), p.itemId(), symbols.getOrDefault(p.itemId(), ""), p.title(), p.body()));
        };

        for (Row row : rows) {
            ItemResponse item = row.item();
            Double price = row.quote() == null ? null : row.quote().price();
            if (price == null || row.quote().stale()) continue; // sin dato fresco no se avisa
            String name = displayName(row);
            String cur = row.quote().currency();

            // Niveles de compra
            List<LevelView> lv = row.metrics().levels();
            for (int i = 0; i < lv.size(); i++) {
                LevelView level = lv.get(i);
                if (level.status() == LevelStatus.unknown) continue;
                String key = item.id() + ":" + i + ":" + num(level.price());
                LevelStatus prev = status(levels.get(key));
                levels.put(key, level.status().name());
                // Primera vez que se ve este nivel (valor nuevo o nivel editado): avisa si ya está cerca o en zona.
                boolean worsened = prev == null
                        ? level.status() == LevelStatus.reached || level.status() == LevelStatus.veryNear
                        : level.status().rank > prev.rank;
                if (!worsened) continue;
                String noteKey = key + ":" + level.status().name();
                if (recently.apply(noteKey)) continue;
                if (level.status() == LevelStatus.reached && prefs.reached()) {
                    push.accept(new Pending(noteKey, AlertKind.reached, item.id(), name + ": en zona de compra",
                            "Cotiza a %s, por debajo de tu compra %d (%s).".formatted(money(price, cur), i + 1,
                                    money(level.price(), cur))));
                } else if (level.status() == LevelStatus.veryNear && prefs.near() && level.distancePct() != null) {
                    push.accept(new Pending(noteKey, AlertKind.near, item.id(), name + ": muy cerca de tu compra " + (i + 1),
                            "Cotiza a %s; le falta caer un %s hasta %s.".formatted(money(price, cur),
                                    pct(level.distancePct()), money(level.price(), cur))));
                }
            }

            if (!prefs.orders() || !item.orderActive()) continue;

            // Precio en la orden puesta en el banco
            if (item.orderPrice() != null && item.orderPrice() != 0) {
                String key = "order:" + item.id() + ":" + num(item.orderPrice());
                String st = price <= item.orderPrice() ? "reached" : "far";
                String prev = levels.put(key, st);
                if (st.equals("reached") && !"reached".equals(prev) && !recently.apply(key + ":reached")) {
                    push.accept(new Pending(key + ":reached", AlertKind.orderTouched, item.id(),
                            name + ": precio en tu orden",
                            "Cotiza a %s, en tu orden de %s. Comprueba en el banco si se ha ejecutado."
                                    .formatted(money(price, cur), money(item.orderPrice(), cur))));
                }
            }

            // Orden a punto de caducar o caducada (un aviso por día restante)
            Long days = row.metrics().orderDaysLeft();
            if (item.orderUntil() != null && days != null && days <= 2) {
                String key = "expira:" + item.id() + ":" + item.orderUntil() + ":" + Math.max(days, -1);
                if (!notified.containsKey(key)) {
                    String when = days < 0 ? "ha caducado" : days == 0 ? "caduca hoy" : days == 1 ? "caduca mañana"
                            : "caduca en " + days + " días";
                    push.accept(new Pending(key, AlertKind.orderExpiring, item.id(), name + ": la orden " + when,
                            days < 0 ? "Renuévala en el banco o quítala de la app."
                                    : "Renuévala en el banco si quieres mantenerla."));
                }
            }
        }

        // Olvidar los niveles que ya no existen (valor quitado, nivel u orden editados): si no, la memoria crece
        // con cada cambio de precio.
        Set<String> current = new HashSet<>();
        Map<String, String> orderUntil = new HashMap<>();
        for (Row row : rows) {
            ItemResponse item = row.item();
            List<LevelView> lv = row.metrics().levels();
            for (int i = 0; i < lv.size(); i++) current.add(item.id() + ":" + i + ":" + num(lv.get(i).price()));
            if (item.orderPrice() != null && item.orderPrice() != 0) current.add("order:" + item.id() + ":" + num(item.orderPrice()));
            orderUntil.put(String.valueOf(item.id()), item.orderUntil() == null ? null : item.orderUntil().toString());
        }
        levels.keySet().removeIf(k -> !current.contains(k));
        // Los avisos ya enviados solo sirven mientras dura la espera entre avisos; los de caducidad, mientras la
        // orden siga con la misma fecha.
        notified.entrySet().removeIf(e -> {
            if (e.getKey().startsWith("expira:")) {
                String[] p = e.getKey().split(":");
                return !p[2].equals(orderUntil.get(p[1]));
            }
            return Duration.between(Instant.parse(e.getValue()), now).compareTo(COOLDOWN) >= 0;
        });
        return new Evaluation(alerts, new Memory(levels, notified, memory.bands()));
    }

    /** Texto del resumen diario (una sola notificación con lo importante), o null sin valores. */
    public static Summary dailySummary(List<Row> rows, LocalDate today, Map<String, String> names) {
        if (rows.isEmpty()) return null;
        List<String> parts = new ArrayList<>();
        List<Row> reached = rows.stream().filter(r -> r.metrics().status() == LevelStatus.reached).toList();
        List<Row> near = rows.stream().filter(r -> r.metrics().status() == LevelStatus.veryNear).toList();
        List<Row> expiring = rows.stream()
                .filter(r -> r.item().orderActive() && r.metrics().orderDaysLeft() != null && r.metrics().orderDaysLeft() <= 3)
                .toList();
        if (!reached.isEmpty()) parts.add(names.get("reached") + ": " + named(reached) + ".");
        if (!near.isEmpty()) parts.add(names.get("veryNear") + ": " + named(near) + ".");
        if (!expiring.isEmpty()) {
            parts.add("Órdenes por caducar: " + String.join(", ", expiring.stream().map(r -> {
                long d = r.metrics().orderDaysLeft();
                return displayName(r) + " (" + (d < 0 ? "caducada" : d + " d") + ")";
            }).toList()) + ".");
        }
        if (parts.isEmpty()) {
            Row nearest = rows.stream().filter(r -> r.metrics().nearestDistancePct() != null)
                    .max(Comparator.comparingDouble(r -> r.metrics().nearestDistancePct())).orElse(null);
            parts.add(nearest == null ? "Nada en zona ni cerca."
                    : "Nada en zona ni cerca. Lo más próximo: %s, a un %s.".formatted(displayName(nearest),
                    pct(nearest.metrics().nearestDistancePct())));
        }
        // Resultados hoy o mañana: suele haber movimientos fuertes de precio.
        List<String> earnings = new ArrayList<>();
        for (Row r : rows) {
            String next = r.targets() == null ? null : r.targets().nextEarnings();
            if (next == null || next.length() < 10) continue;
            try {
                long days = ChronoUnit.DAYS.between(today, LocalDate.parse(next.substring(0, 10)));
                if (days == 0 || days == 1) earnings.add(displayName(r) + " (" + (days == 0 ? "hoy" : "mañana") + ")");
            } catch (RuntimeException ignored) {
                // Fecha ilegible: se omite.
            }
        }
        if (!earnings.isEmpty()) parts.add("Resultados: " + String.join(", ", earnings) + ".");
        return new Summary("Watchlist: resumen de hoy", String.join(" ", parts));
    }

    static String displayName(Row r) {
        if (r.item().name() != null) return r.item().name();
        if (r.quote() != null && r.quote().name() != null) return r.quote().name();
        return r.item().symbol();
    }

    /** Un mismo valor puede estar en varias listas: se nombra una sola vez. */
    private static String named(List<Row> rows) {
        Set<String> names = new LinkedHashSet<>();
        rows.forEach(r -> names.add(displayName(r)));
        return String.join(", ", names);
    }

    private static LevelStatus status(String name) {
        if (name == null) return null;
        try {
            return LevelStatus.valueOf(name);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** El número como lo escribe JavaScript ({@code 64}, {@code 64.2}): forma parte de las claves guardadas. */
    static String num(double v) {
        return BigDecimal.valueOf(v).stripTrailingZeros().toPlainString();
    }

    /** Importe con su divisa al estilo español ({@code 64,20 €}). Los peniques (GBp) se pasan a libras. */
    static String money(double v, String currency) {
        String cur = "GBp".equals(currency) ? "GBP" : currency;
        double value = "GBp".equals(currency) ? v / 100 : v;
        DecimalFormat f = new DecimalFormat("0.00", DecimalFormatSymbols.getInstance(ES));
        f.setMaximumFractionDigits(Math.abs(value) < 10 ? 3 : 2);
        if (cur == null) f.setMinimumFractionDigits(0);
        // Como Intl en español: sin separador de miles por debajo de 10 000.
        if (Math.abs(value) >= 10_000) {
            f.setGroupingUsed(true);
            f.setGroupingSize(3);
        }
        String n = f.format(value);
        if (cur == null) return n;
        String symbol = switch (cur) {
            case "EUR" -> "€";
            case "USD" -> "US$";
            case "GBP" -> "GBP";
            default -> cur;
        };
        return n + " " + symbol; // espacio duro, como Intl
    }

    /** Porcentaje (de una fracción) en positivo con un decimal como mucho: {@code 3,5 %}. */
    static String pct(double v) {
        DecimalFormat f = new DecimalFormat("0.#", DecimalFormatSymbols.getInstance(ES));
        if (Math.abs(v * 100) >= 1000) {
            f.setGroupingUsed(true);
            f.setGroupingSize(3);
        }
        return f.format(Math.abs(v * 100)) + " %";
    }
}
