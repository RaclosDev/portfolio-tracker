package com.cartera.dto.market;

/** Una bolsa donde se puede seguir un producto, con su último precio. {@code priceOnly}: sin gráfico ni histórico. */
public record Listing(String symbol, String name, String exchange, String type, String currency, Double price,
                      boolean priceOnly) {
}
