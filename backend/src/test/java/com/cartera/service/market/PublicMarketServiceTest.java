package com.cartera.service.market;

import com.cartera.dto.market.Candle;
import com.cartera.dto.market.CandlesResult;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.dto.market.Quote;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PublicMarketServiceTest {

    private static Quote quote(String symbol, Double price) {
        return new Quote(symbol, symbol, "EUR", price, 0.01, price, null, null, "EQUITY", "BME", "REGULAR",
                "2026-11-20T10:00:00Z", null, null, null, null, null, false, false);
    }

    @Test
    void landingAsksOnlyForItsSymbolsAndIsCached() {
        MarketService market = mock(MarketService.class);
        when(market.getQuotes(anyList())).thenReturn(Map.of("IBE.MC", quote("IBE.MC", 17.1), "MSFT", quote("MSFT", null)));
        when(market.getCandles(any(), eq(IntradayInterval.M5)))
                .thenReturn(new CandlesResult(List.of(new Candle("2026-11-20T09:00Z", 17, 17.2, 16.9, 17.1)), false));
        PublicMarketService service = new PublicMarketService(market);

        PublicMarketService.Snapshot first = service.landing();
        assertThat(first.quotes()).containsOnlyKeys("IBE.MC");
        assertThat(first.candles()).containsOnlyKeys(PublicMarketService.LANDING.toArray(String[]::new));
        assertThat(service.landing()).isSameAs(first);
        verify(market, times(1)).getQuotes(PublicMarketService.LANDING);
    }

    @Test
    void demoIntradayOnlyServesItsCatalogAndCachesWhatItGets() {
        MarketService market = mock(MarketService.class);
        when(market.getCandles("MSFT", IntradayInterval.M15))
                .thenReturn(new CandlesResult(List.of(new Candle("2026-11-20T15:30Z", 500, 502, 499, 501)), false));
        when(market.getCandles("AAPL", IntradayInterval.M15)).thenReturn(new CandlesResult(List.of(), true));
        PublicMarketService service = new PublicMarketService(market);

        assertThat(service.demoIntraday("XYZ", IntradayInterval.M15)).isEmpty();
        verify(market, times(0)).getCandles(eq("XYZ"), any());
        assertThat(service.demoIntraday("MSFT", IntradayInterval.M15)).hasSize(1);
        service.demoIntraday("MSFT", IntradayInterval.M15);
        verify(market, times(1)).getCandles("MSFT", IntradayInterval.M15);
        // Sin datos no se guarda: se vuelve a pedir.
        service.demoIntraday("AAPL", IntradayInterval.M15);
        service.demoIntraday("AAPL", IntradayInterval.M15);
        verify(market, times(2)).getCandles("AAPL", IntradayInterval.M15);
    }
}
