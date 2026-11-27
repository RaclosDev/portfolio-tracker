package com.cartera.service.market;

import com.cartera.dto.market.Quote;
import com.cartera.repository.MarketCacheRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Un precio de una fuente alternativa en otra divisa no debe tomarse por fresco: los niveles no llevan divisa. */
class MarketServiceCurrencyTest {

    private final MarketDataProvider provider = mock(MarketDataProvider.class);

    @SuppressWarnings("unchecked")
    private final MarketService service = new MarketService(provider, mock(MarketCacheRepository.class),
            JsonMapper.builder().build(), mock(ObjectProvider.class), mock(OpenFigiClient.class), 60, 12);

    private static Quote quote(String currency, double price) {
        return new Quote("VWCE", "Fondo", currency, price, 0d, price, null, null, null, null, "REGULAR", null, null,
                null, null, null, null, false, false);
    }

    @Test
    void aQuoteInAnotherCurrencyIsServedAsStaleInsteadOfFresh() {
        when(provider.getQuotes(anyList())).thenReturn(List.of(quote("USD", 100)));
        assertThat(service.getQuotes(List.of("VWCE"), true, 0).get("VWCE").stale()).isFalse();

        // Yahoo falla y responde la alternativa, siempre en euros: 92 EUR no es comparable con un nivel de 95 USD.
        when(provider.getQuotes(anyList())).thenReturn(List.of(quote("EUR", 92)));
        Quote served = service.getQuotes(List.of("VWCE"), true, 0).get("VWCE");
        assertThat(served.currency()).isEqualTo("USD");
        assertThat(served.price()).isEqualTo(100);
        assertThat(served.stale()).isTrue();
    }

    @Test
    void theSameCurrencyKeepsBeingFresh() {
        when(provider.getQuotes(anyList())).thenReturn(List.of(quote("USD", 100)));
        service.getQuotes(List.of("VWCE"), true, 0);
        when(provider.getQuotes(anyList())).thenReturn(List.of(quote("USD", 101)));
        Quote served = service.getQuotes(List.of("VWCE"), true, 0).get("VWCE");
        assertThat(served.price()).isEqualTo(101);
        assertThat(served.stale()).isFalse();
    }
}
