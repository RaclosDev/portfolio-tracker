package com.cartera.dto.market;

/**
 * Vela: fecha AAAA-MM-DD (diaria) o fecha y hora UTC de su inicio (intradía). El volumen (títulos negociados) es
 * null si la fuente no lo da (fondos, sesión completada con FT).
 */
public record Candle(String t, double o, double h, double l, double c, Double v) {

    public Candle(String t, double o, double h, double l, double c) {
        this(t, o, h, l, c, null);
    }
}
