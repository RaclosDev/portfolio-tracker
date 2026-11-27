package com.cartera.service.market.composition;

import com.cartera.dto.market.FundComposition;
import com.cartera.dto.market.FundHolding;
import com.cartera.repository.MarketCacheRepository;
import com.cartera.service.market.OpenFigiClient;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CompositionServiceTest {

    @Test
    void aSlowOpenFigiDoesNotHoldBackTheCompositionAndTheTickerArrivesLater() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        OpenFigiClient figi = mock(OpenFigiClient.class);
        when(figi.homeTickers(anyList())).thenAnswer(i -> {
            release.await(10, TimeUnit.SECONDS);
            return Map.of("US4592001014", "IBM");
        });
        CompositionSource source = new CompositionSource() {
            @Override
            public String id() {
                return "prueba";
            }

            @Override
            public Result getComposition(Ref ref) {
                return new Result(List.of(new FundHolding("IBM", "US4592001014", null, 0.5)), null);
            }
        };
        CompositionService service = new CompositionService(List.of(source), mock(MarketCacheRepository.class),
                JsonMapper.builder().build(), figi);
        service.figiWaitMs = 100;

        long start = System.nanoTime();
        FundComposition first = service.getComposition(new CompositionSource.Ref("IE00B4L5Y983", "IWDA.AS"));
        long tookMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

        // Sin esperar a OpenFIGI (que sigue en segundo plano): la composición sale, aún sin el ticker.
        assertThat(tookMs).isLessThan(5_000);
        assertThat(first.holdings().getFirst().ticker()).isNull();

        release.countDown();
        FundComposition later = null;
        for (int i = 0; i < 100; i++) {
            later = service.getComposition(new CompositionSource.Ref("IE00B4L5Y983", "IWDA.AS"));
            if ("IBM".equals(later.holdings().getFirst().ticker())) break;
            Thread.sleep(50);
        }
        assertThat(later.holdings().getFirst().ticker()).isEqualTo("IBM");
    }
}
