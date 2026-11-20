package com.cartera.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;

/**
 * Datos completos de un valor vigilado. Lo usa el alta tal cual, y el PATCH y la importación
 * después de aplicar los cambios sobre el valor que ya existe.
 */
public record ItemRequest(
        @NotNull @Positive Long listId,
        @NotBlank @Size(max = 32) String symbol,
        @Size(max = 32) String ticker,
        @Size(max = 12) String isin,
        @Size(max = 120) String name,
        @Size(max = MAX_BUY_LEVELS) List<@NotNull @Positive Double> buyPrices,
        @Positive Double brokerTarget,
        @Size(max = 40) String brokerName,
        @Positive Double investAmount,
        @Positive Integer sharesOverride,
        Boolean orderActive,
        @Positive Double orderPrice,
        LocalDate orderUntil,
        @Size(max = 2000) String notes,
        /** Fecha AAAA-MM-DD (incluida) o {@code "always"}. */
        @Pattern(regexp = "[0-9]{4}-[0-9]{2}-[0-9]{2}|always", message = "debe ser una fecha AAAA-MM-DD o «always»")
        String mutedUntil) {

    public static final int MAX_BUY_LEVELS = 3;
    public static final String MUTED_FOREVER = "always";

    public ItemRequest {
        symbol = symbol == null ? null : symbol.trim().toUpperCase(Locale.ROOT);
        ticker = upperOrNull(ticker);
        isin = upperOrNull(isin);
        name = trimOrNull(name);
        brokerName = trimOrNull(brokerName);
        notes = notes == null || notes.isBlank() ? null : notes;
        buyPrices = buyPrices == null ? List.of() : buyPrices;
        orderActive = Boolean.TRUE.equals(orderActive);
    }

    public ItemRequest withListId(Long newListId) {
        return new ItemRequest(newListId, symbol, ticker, isin, name, buyPrices, brokerTarget, brokerName, investAmount,
                sharesOverride, orderActive, orderPrice, orderUntil, notes, mutedUntil);
    }

    public ItemRequest withIsin(String newIsin) {
        return new ItemRequest(listId, symbol, ticker, newIsin, name, buyPrices, brokerTarget, brokerName, investAmount,
                sharesOverride, orderActive, orderPrice, orderUntil, notes, mutedUntil);
    }

    private static String trimOrNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String upperOrNull(String s) {
        String t = trimOrNull(s);
        return t == null ? null : t.toUpperCase(Locale.ROOT);
    }
}
