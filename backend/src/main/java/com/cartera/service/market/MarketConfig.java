package com.cartera.service.market;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.util.List;

/** Orden en que se consultan las fuentes de mercado: la primera que responde gana. */
@Configuration
public class MarketConfig {

    @Bean
    @Primary
    public FallbackProvider marketProvider(YahooProvider yahoo) {
        return new FallbackProvider(List.of(yahoo));
    }
}
