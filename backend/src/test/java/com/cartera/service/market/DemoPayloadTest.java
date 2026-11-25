package com.cartera.service.market;

import com.cartera.dto.market.Candle;
import com.cartera.dto.market.CandlesResult;
import com.cartera.dto.market.Quote;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DemoPayloadTest {

    @Test
    void encodesOncePerSnapshotWithAMatchingGzip() throws Exception {
        MarketService market = mock(MarketService.class);
        when(market.getQuotes(anyList())).thenReturn(Map.of("IBE.MC", new Quote("IBE.MC", "Iberdrola", "EUR", 17.1, 0.01,
                17.0, null, null, "EQUITY", "BME", "REGULAR", "2026-11-20T10:00:00Z", null, null, null, null, null, false, false)));
        when(market.getCandles(any(), any()))
                .thenReturn(new CandlesResult(List.of(new Candle("2026-11-20", 17, 17.2, 16.9, 17.1)), false));
        JsonMapper mapper = JsonMapper.builder().build();
        DemoPayload payload = new DemoPayload(new PublicMarketService(market), mapper);

        DemoPayload.Encoded full = payload.full();
        assertThat(payload.full()).isSameAs(full);
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(full.gzip()))) {
            assertThat(in.readAllBytes()).isEqualTo(full.json());
        }
        assertThat(mapper.readTree(full.json()).get("candles").has("IBE.MC")).isTrue();

        DemoPayload.Encoded quotes = payload.quotes();
        assertThat(mapper.readTree(quotes.json()).get("quotes").has("IBE.MC")).isTrue();
        assertThat(mapper.readTree(quotes.json()).get("candles").isEmpty()).isTrue();
        verify(market, times(1)).getQuotes(PublicMarketService.DEMO);
    }
}
