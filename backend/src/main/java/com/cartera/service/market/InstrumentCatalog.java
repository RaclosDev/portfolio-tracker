package com.cartera.service.market;

import com.cartera.dto.market.InstrumentHit;

import java.util.List;

/** Catálogo de productos por nombre, ISIN o WKN (sin precios). */
public interface InstrumentCatalog {

    List<InstrumentHit> findInstruments(String query);
}
