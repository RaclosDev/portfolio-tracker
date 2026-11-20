package com.cartera.service.watchlist;

import com.cartera.dto.ItemResponse;
import com.cartera.dto.Settings;
import com.cartera.dto.WatchlistView.LevelStatus;
import com.cartera.dto.WatchlistView.LevelView;
import com.cartera.dto.WatchlistView.RowMetrics;
import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.Quote;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/** Cálculos de cada fila de una lista: distancia a los niveles de compra, acciones, importes y potencial. */
public final class Metrics {

    private Metrics() {
    }

    private static double pct(double to, double from) {
        return (to - from) / from;
    }

    /**
     * Estado de un nivel de compra respecto al precio actual:
     * en zona (precio ≤ nivel) · muy cerca (≤ veryNear %) · cerca (≤ near %) · lejos (≤ far %) · muy lejos.
     */
    public static LevelStatus levelStatus(double level, Double price, Settings.Bands bands) {
        if (price == null || price <= 0) return LevelStatus.unknown;
        if (price <= level) return LevelStatus.reached;
        double dist = -pct(level, price) * 100; // % que tiene que caer
        double near = Math.max(bands.near(), bands.veryNear());
        if (dist <= bands.veryNear()) return LevelStatus.veryNear;
        if (dist <= near) return LevelStatus.near;
        return dist <= Math.max(bands.far(), near) ? LevelStatus.far : LevelStatus.veryFar;
    }

    public static LevelStatus bestStatus(List<LevelStatus> statuses) {
        LevelStatus best = LevelStatus.unknown;
        for (LevelStatus s : statuses) if (s.rank > best.rank) best = s;
        return best;
    }

    /**
     * Acciones a comprar: siempre se redondea a la unidad superior (nunca por debajo del importe).
     * El margen evita que errores de coma flotante (200,0000000001) suban una acción de más.
     */
    public static int roundUpShares(double exact) {
        return (int) Math.ceil(exact - 1e-9);
    }

    /** {@code fxRate}: unidades de la divisa del valor por 1 de divisa base (1 si coinciden). */
    public static RowMetrics compute(ItemResponse item, Quote quote, AnalystTargets targets, Double fxRate,
                                     Settings settings, LocalDate today) {
        Double price = quote == null ? null : quote.price();
        boolean hasPrice = truthy(price);
        List<LevelView> levels = new ArrayList<>();
        for (double lp : item.buyPrices()) {
            levels.add(new LevelView(lp, hasPrice ? pct(lp, price) : null, levelStatus(lp, price, settings.bands())));
        }
        LevelStatus status = bestStatus(levels.stream().map(LevelView::status).toList());
        Double nearest = null;
        if (status == LevelStatus.reached) {
            nearest = 0.0;
        } else {
            for (LevelView l : levels) {
                if (l.distancePct() != null && l.status() != LevelStatus.reached
                        && (nearest == null || l.distancePct() > nearest)) nearest = l.distancePct();
            }
        }

        double investAmount = item.investAmount() != null ? item.investAmount() : settings.defaultInvest();
        Double entryPrice = item.orderActive() && truthy(item.orderPrice()) ? item.orderPrice()
                : item.buyPrices().isEmpty() ? null : item.buyPrices().getFirst();
        boolean entry = truthy(entryPrice);
        boolean fx = truthy(fxRate);
        Double sharesCalc = entry && fx ? investAmount * fxRate / entryPrice : null;
        Integer shares = item.sharesOverride() != null ? item.sharesOverride()
                : sharesCalc != null ? Integer.valueOf(roundUpShares(sharesCalc)) : null;
        Double netNative = shares != null && entry ? shares * entryPrice : null;
        Double netBase = netNative != null && fx ? netNative / fxRate : null;
        Double diffBase = shares != null && entry && hasPrice && fx ? shares * (price - entryPrice) / fxRate : null;

        Double upsideBroker = truthy(item.brokerTarget()) && hasPrice ? pct(item.brokerTarget(), price) : null;
        Double upsideConsensus = targets != null && truthy(targets.mean()) && hasPrice ? pct(targets.mean(), price) : null;

        Long orderDaysLeft = item.orderActive() && item.orderUntil() != null
                ? ChronoUnit.DAYS.between(today, item.orderUntil()) : null;

        return new RowMetrics(levels, status, nearest, fxRate, investAmount, sharesCalc, shares, entryPrice, netNative,
                netBase, diffBase, upsideBroker, upsideConsensus, orderDaysLeft, orderDaysLeft != null && orderDaysLeft < 0);
    }

    /** Como en JavaScript: ni null, ni 0, ni NaN. */
    private static boolean truthy(Double v) {
        return v != null && v != 0 && !v.isNaN();
    }
}
