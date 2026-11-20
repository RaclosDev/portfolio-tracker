package com.cartera.dto;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.Quote;

import java.util.List;
import java.util.Map;

/** Una lista en pantalla: cada valor con su cotización, consenso y cálculos, y los tipos de cambio usados. */
public record WatchlistView(
        ListResponse list, Settings settings, List<Row> rows, Map<String, Double> fx, List<String> fxStale,
        String generatedAt, String throttledUntil) {

    public record Row(ItemResponse item, Quote quote, AnalystTargets targets, RowMetrics metrics) {
    }

    /** Estado de un nivel de compra respecto al precio: en zona, muy cerca, cerca, lejos, muy lejos o sin precio. */
    public enum LevelStatus {
        reached(5), veryNear(4), near(3), far(2), veryFar(1), unknown(0);

        /** Mayor = más urgente. */
        public final int rank;

        LevelStatus(int rank) {
            this.rank = rank;
        }
    }

    public record LevelView(double price, Double distancePct, LevelStatus status) {
    }

    public record RowMetrics(
            List<LevelView> levels, LevelStatus status, Double nearestDistancePct, Double fxRate, double investAmount,
            Double sharesCalc, Integer shares, Double entryPrice, Double netNative, Double netBase, Double diffBase,
            Double upsideBrokerPct, Double upsideConsensusPct, Long orderDaysLeft, boolean orderExpired) {
    }
}
