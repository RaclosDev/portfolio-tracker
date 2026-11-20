package com.cartera.dto;

import com.cartera.model.WatchItem;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record ItemResponse(
        Long id, Long listId, String symbol, String ticker, String isin, String name, List<Double> buyPrices,
        Double brokerTarget, String brokerName, Double investAmount, Integer sharesOverride,
        boolean orderActive, Double orderPrice, LocalDate orderUntil, String notes, String mutedUntil,
        Instant createdAt, Instant updatedAt) {

    public static ItemResponse of(WatchItem i) {
        String muted = i.isMutedForever() ? ItemRequest.MUTED_FOREVER : i.getMutedUntil() == null ? null : i.getMutedUntil().toString();
        return new ItemResponse(i.getId(), i.getList().getId(), i.getSymbol(), i.getTicker(), i.getIsin(), i.getName(),
                List.copyOf(i.getBuyPrices()), i.getBrokerTarget(), i.getBrokerName(), i.getInvestAmount(),
                i.getSharesOverride(), i.isOrderActive(), i.getOrderPrice(), i.getOrderUntil(), i.getNotes(), muted,
                i.getCreatedAt(), i.getUpdatedAt());
    }

    /** Los mismos datos como petición: punto de partida de un PATCH. */
    public ItemRequest toRequest() {
        return new ItemRequest(listId, symbol, ticker, isin, name, buyPrices, brokerTarget, brokerName, investAmount,
                sharesOverride, orderActive, orderPrice, orderUntil, notes, mutedUntil);
    }
}
