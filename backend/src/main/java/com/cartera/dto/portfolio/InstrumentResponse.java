package com.cartera.dto.portfolio;

import com.cartera.model.Instrument;

public record InstrumentResponse(String ticker, String symbol, String name, String sector, String currency, String isin,
                                 String notes) {

    public static InstrumentResponse of(Instrument i) {
        return new InstrumentResponse(i.getTicker(), i.getSymbol(), i.getName(), i.getSector(), i.getCurrency(),
                i.getIsin(), i.getNotes());
    }

    public InstrumentRequest toRequest() {
        return new InstrumentRequest(ticker, symbol, name, sector, currency, isin, notes);
    }
}
