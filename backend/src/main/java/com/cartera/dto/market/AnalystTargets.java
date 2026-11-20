package com.cartera.dto.market;

/** Consenso de analistas y datos fundamentales (rentabilidad por dividendo en fracción: 0,028 = 2,8 %). */
public record AnalystTargets(
        Double mean, Double median, Double high, Double low, Integer analysts, String recommendation,
        Double recommendationMean, String nextEarnings, String exDividend, Double dividendYield, Double trailingPE,
        Double marketCap, String fetchedAt) {

    public AnalystTargets withFetchedAt(String fetchedAt) {
        return new AnalystTargets(mean, median, high, low, analysts, recommendation, recommendationMean, nextEarnings,
                exDividend, dividendYield, trailingPE, marketCap, fetchedAt);
    }
}
