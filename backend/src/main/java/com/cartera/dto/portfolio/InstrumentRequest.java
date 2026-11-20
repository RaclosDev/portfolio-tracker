package com.cartera.dto.portfolio;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Datos completos de un valor. Los cambios parciales ({@code PUT /api/instruments/{ticker}} y el valor que
 * acompaña a una operación) se fusionan sobre el guardado y se validan con esta forma.
 */
public record InstrumentRequest(
        @NotBlank @Size(max = 32) String ticker,
        @Size(max = 32) String symbol,
        @Size(max = 120) String name,
        @Size(max = 80) String sector,
        @NotNull(message = "La divisa debe tener tres letras, como EUR o USD")
        @Pattern(regexp = "[A-Z]{3}", message = "La divisa debe tener tres letras, como EUR o USD") String currency,
        @Size(max = 12) String isin,
        @Size(max = 1000) String notes) {

    public InstrumentRequest {
        ticker = ticker == null ? null : ticker.trim().toUpperCase();
        symbol = symbol == null ? null : symbol.trim().toUpperCase();
        name = trim(name);
        sector = trim(sector);
        // En mayúsculas: «usd» y «USD» deben ser la misma divisa en los cambios y la valoración.
        currency = currency == null ? null : currency.trim().toUpperCase();
        isin = trim(isin);
    }

    public static InstrumentRequest empty(String ticker) {
        return new InstrumentRequest(ticker, null, null, null, "EUR", null, null);
    }

    private static String trim(String s) {
        return s == null ? null : s.trim();
    }
}
