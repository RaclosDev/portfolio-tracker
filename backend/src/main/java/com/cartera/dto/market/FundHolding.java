package com.cartera.dto.market;

/**
 * Una posición dentro de un fondo o ETF. {@code ticker}: tal como lo da la fuente (NVDA, NVDA:NSQ…), si lo da;
 * {@code weight}: peso en el fondo, de 0 a 1.
 */
public record FundHolding(String name, String isin, String ticker, double weight) {

    public FundHolding withTicker(String value) {
        return new FundHolding(name, isin, value, weight);
    }

    public FundHolding withWeight(double value) {
        return new FundHolding(name, isin, ticker, value);
    }
}
