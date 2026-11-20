package com.cartera.dto.portfolio;

import com.cartera.model.Operation;
import com.cartera.model.OperationType;

import java.time.Instant;

public record OperationResponse(
        Long id, String date, String ticker, OperationType type, Double shares, Double price, double fees,
        double fxRate, double amountEur, Double withholdingEs, Double withholdingForeign, Double splitRatio,
        String broker, String notes, boolean needsReview, String source, Integer sourceRef, Integer lotRef,
        Integer dayOrder, String transferRef, Instant createdAt, Instant updatedAt) {

    public static OperationResponse of(Operation o) {
        return new OperationResponse(o.getId(), o.getDate().toString(), o.getTicker(), o.getType(), o.getShares(),
                o.getPrice(), o.getFees(), o.getFxRate(), o.getAmountEur(), o.getWithholdingEs(),
                o.getWithholdingForeign(), o.getSplitRatio(), o.getBroker(), o.getNotes(), o.isNeedsReview(),
                o.getSource(), o.getSourceRef(), o.getLotRef(), o.getDayOrder(), o.getTransferRef(),
                o.getCreatedAt(), o.getUpdatedAt());
    }

    /** Los mismos datos como petición (copias de seguridad, huella de duplicados). */
    public OperationRequest toRequest() {
        return new OperationRequest(date, ticker, type, shares, price, fees, fxRate, amountEur, withholdingEs,
                withholdingForeign, splitRatio, broker, notes, needsReview, source, sourceRef, lotRef, dayOrder, transferRef);
    }
}
