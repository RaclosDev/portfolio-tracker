package com.cartera.service.market;

import com.cartera.dto.market.Dividend;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class YahooDividendsTest {

    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void dividendosPorFechaExEnElDiaDeLaBolsa() {
        // 1651129200 = 2022-04-28 07:00 UTC; 1667257200 = 2022-10-31 23:00 UTC, ya 1 de noviembre en Madrid.
        String body = """
                {"meta":{"exchangeTimezoneName":"Europe/Madrid"},
                 "events":{"dividends":{
                   "1667257200":{"amount":0.0583,"date":1667257200},
                   "1648764000":{"amount":0.0515,"date":1651129200},
                   "1":{"amount":0,"date":1651129300}}}}""";
        assertThat(YahooProvider.dividendsFromChart(json.readTree(body))).containsExactly(
                new Dividend("2022-04-28", 0.0515), new Dividend("2022-11-01", 0.0583));
    }

    @Test
    void sinDividendosListaVacia() {
        assertThat(YahooProvider.dividendsFromChart(json.readTree("{\"meta\":{}}"))).isEmpty();
    }
}
