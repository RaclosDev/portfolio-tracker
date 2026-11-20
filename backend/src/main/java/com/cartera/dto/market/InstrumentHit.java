package com.cartera.dto.market;

/** Un producto (acción, ETF, fondo…) identificado por su ISIN, sin elegir aún la bolsa. */
public record InstrumentHit(String isin, String name, String type) {
}
