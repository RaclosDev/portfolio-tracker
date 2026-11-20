package com.cartera.service.market;

import com.cartera.dto.market.InstrumentHit;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Orden en que se consultan las fuentes de mercado: la primera que responde gana. */
@Slf4j
@Configuration
public class MarketConfig {

    @Bean
    @Primary
    public FallbackProvider marketProvider(FinancialHubProvider financialHub, YahooProvider yahoo, BorsaProvider borsa,
                                           QuefondosProvider quefondos, OnvistaProvider onvista, JustEtfProvider justEtf,
                                           FtProvider ft) {
        return new FallbackProvider(List.of(financialHub, yahoo, borsa, quefondos, onvista, justEtf, ft));
    }

    /** onvista y Euronext como un solo catálogo: se consultan a la vez y el que falla no tapa al otro. */
    @Bean
    @Primary
    public InstrumentCatalog instrumentCatalog(OnvistaProvider onvista, EuronextCatalog euronext) {
        List<InstrumentCatalog> catalogs = List.of(onvista, euronext);
        return query -> {
            List<List<InstrumentHit>> lists = catalogs.stream()
                    .map(c -> CompletableFuture.supplyAsync(() -> c.findInstruments(query))
                            .exceptionally(e -> {
                                log.warn("No se pudo buscar el producto «{}»: {}", query, e.getMessage());
                                return List.of();
                            }))
                    .toList().stream().map(CompletableFuture::join).toList();
            // Intercalados: el primer acierto de cada catálogo queda arriba, no detrás de todos los del anterior.
            List<InstrumentHit> merged = new ArrayList<>();
            int longest = lists.stream().mapToInt(List::size).max().orElse(0);
            for (int i = 0; i < longest; i++) {
                for (List<InstrumentHit> l : lists) if (i < l.size()) merged.add(l.get(i));
            }
            return merged;
        };
    }
}
