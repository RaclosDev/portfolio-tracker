package com.cartera.service.portfolio;

import com.cartera.dto.portfolio.InstrumentRequest;
import com.cartera.dto.portfolio.OperationRequest;
import com.cartera.model.Instrument;
import com.cartera.model.Operation;

import java.time.Instant;

/** Copia los datos validados de una petición sobre la entidad (alta, cambio, importación y restauración). */
public final class PortfolioMapper {

    private PortfolioMapper() {
    }

    public static void apply(Operation o, OperationRequest r) {
        o.setDate(r.localDate());
        o.setTicker(r.ticker());
        o.setType(r.type());
        o.setShares(r.shares());
        o.setPrice(r.price());
        o.setFees(r.fees());
        o.setFxRate(r.fxRate());
        o.setAmountEur(r.amountEur());
        o.setWithholdingEs(r.withholdingEs());
        o.setWithholdingForeign(r.withholdingForeign());
        o.setSplitRatio(r.splitRatio());
        o.setBroker(r.broker());
        o.setNotes(r.notes());
        o.setNeedsReview(r.needsReview());
        o.setSource(r.source());
        o.setSourceRef(r.sourceRef());
        o.setLotRef(r.lotRef());
        o.setDayOrder(r.dayOrder());
        o.setTransferRef(r.transferRef());
    }

    public static void apply(Instrument i, InstrumentRequest r) {
        i.setSymbol(r.symbol());
        i.setName(r.name());
        i.setSector(r.sector());
        i.setCurrency(r.currency());
        i.setIsin(r.isin());
        i.setNotes(r.notes());
        i.setUpdatedAt(Instant.now());
    }
}
