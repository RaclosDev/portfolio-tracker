package com.cartera.dto.market;

/** Vela: fecha AAAA-MM-DD (diaria) o fecha y hora UTC de su inicio (intradía). */
public record Candle(String t, double o, double h, double l, double c) {
}
