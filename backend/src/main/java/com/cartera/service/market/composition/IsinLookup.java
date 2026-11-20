package com.cartera.service.market.composition;

import com.cartera.dto.market.Quote;
import com.cartera.service.market.MarketService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;

/** ISIN de un valor por su cotización: el que da la propia cotización o, en fondos y ETF, Financial Hub. */
@Slf4j
@Component
@RequiredArgsConstructor
public class IsinLookup {

    private final MarketService market;
    private final FinancialHubComposition financialHub;

    /** null si no se sabe (o la fuente no contesta: el ISIN es opcional y no debe impedir guardar). */
    public String isinOf(String symbol) {
        if (symbol == null || symbol.isBlank()) return null;
        try {
            Quote quote = market.getQuotes(List.of(symbol)).get(symbol);
            if (quote != null && quote.isin() != null) return quote.isin();
            return financialHub.isinOf(symbol);
        } catch (RuntimeException e) {
            log.debug("Sin ISIN de {}: {}", symbol, e.getMessage());
            return null;
        }
    }
}
