package com.cartera.service.watchlist;

import com.cartera.dto.ItemResponse;
import com.cartera.dto.ListResponse;
import com.cartera.dto.Settings;
import com.cartera.dto.market.Quote;
import com.cartera.repository.WatchItemRepository;
import com.cartera.service.SettingsService;
import com.cartera.service.VisitedService;
import com.cartera.service.market.MarketService;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WatchlistViewServiceTest {

    private final WatchItemRepository items = mock(WatchItemRepository.class);
    private final MarketService market = mock(MarketService.class);
    private final TransactionTemplate tx = mock(TransactionTemplate.class);
    private final WatchlistViewService service = new WatchlistViewService(mock(WatchListService.class), items,
            mock(VisitedService.class), mock(SettingsService.class), market, tx);

    @Test
    void theIsinOfTheQuoteIsWrittenOnceNotOnEveryRefresh() {
        // El TransactionTemplate de mentira ejecuta el cuerpo, como el real.
        doAnswer(i -> {
            Consumer<TransactionStatus> body = i.getArgument(0);
            body.accept(null);
            return null;
        }).when(tx).executeWithoutResult(any());
        Quote quote = new Quote("SAN.MC", "Santander", "EUR", 10d, 0d, 10d, null, null, null, null, "REGULAR", null,
                null, null, null, null, "ES0113900J37", false, false);
        when(market.getQuotes(anyList(), anyBoolean(), anyLong())).thenReturn(Map.of("SAN.MC", quote));
        ItemResponse item = new ItemResponse(7L, 1L, "SAN.MC", "SAN", null, "Santander", List.of(), null, null, null,
                null, false, null, null, null, null, null, null);
        ListResponse list = new ListResponse(1L, "Lista", 1);

        for (int i = 0; i < 5; i++) {
            var view = service.build(list, List.of(item), Settings.DEFAULTS, false, 9_500L);
            assertThat(view.rows().getFirst().item().isin()).isEqualTo("ES0113900J37");
        }
        verify(items, times(1)).fillIsin(7L, "SAN.MC", "ES0113900J37");
    }
}
