package com.cartera.service.market;

import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.Candle;
import com.cartera.dto.market.CompanyProfile;
import com.cartera.dto.market.DailyHistory;
import com.cartera.dto.market.Dividend;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Una fuente de datos de mercado. Los métodos opcionales devuelven null cuando la fuente no los ofrece; los
 * obligatorios lanzan {@link MarketSourceException} si la fuente falla.
 */
public interface MarketDataProvider {

    String id();

    /** Cotizaciones de los símbolos que la fuente conoce (los demás no salen). */
    List<Quote> getQuotes(List<String> symbols);

    /** Consenso de analistas; null si la fuente no lo tiene para ese valor. */
    AnalystTargets getTargets(String symbol);

    List<SymbolSearchResult> search(String query);

    List<PricePoint> getHistory(String symbol, HistoryRange range);

    /** Cierres diarios desde {@code from} sin ajustar dividendos. */
    default DailyHistory getDailyHistory(String symbol, LocalDate from) {
        return null;
    }

    /** Velas diarias desde {@code from}. */
    default List<Candle> getCandles(String symbol, LocalDate from) {
        return null;
    }

    default List<Candle> getIntradayCandles(String symbol, IntradayInterval interval) {
        return null;
    }

    /** Dividendos de toda la historia (fecha ex e importe tras splits); null si la fuente no los tiene. */
    default List<Dividend> getDividends(String symbol) {
        return null;
    }

    default CompanyProfile getProfile(String symbol) {
        return null;
    }

    /** Estado interno para /api/health (sin secretos ni consultas). */
    default Map<String, Object> diagnostics() {
        return Map.of();
    }
}
