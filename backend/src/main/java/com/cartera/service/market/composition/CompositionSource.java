package com.cartera.service.market.composition;

import com.cartera.dto.market.FundHolding;

import java.util.List;

/**
 * Una fuente de composición de fondos y ETF. Devuelve null si no conoce el fondo; lanza si la fuente falla
 * (así se distingue «no existe» de «no se ha podido preguntar»).
 */
public interface CompositionSource {

    /** Fondo a buscar: su ISIN si se sabe y el símbolo con el que se sigue (ticker de Yahoo, «FT:…», «XETRA:…»). */
    record Ref(String isin, String symbol) {
    }

    /** Posiciones y fecha (AAAA-MM-DD o null), sin la fuente ni la hora de consulta. */
    record Result(List<FundHolding> holdings, String asOf) {
    }

    String id();

    Result getComposition(Ref ref);
}
