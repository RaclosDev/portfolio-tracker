package com.cartera.service.market;

import com.cartera.dto.market.DailyHistory;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class YahooDailyHistoryTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void closesBeforeASplitAreNotAdjustedASecondTime() {
        // Yahoo ya entrega los cierres anteriores al split en la escala de hoy (110, no 1.100).
        JsonNode chart = JSON.readTree("""
                {"meta":{"currency":"USD","exchangeTimezoneName":"UTC"},
                 "timestamp":[1717977600,1718064000],
                 "events":{"splits":{"1718026200":{"date":1718026200,"numerator":10,"denominator":1}}},
                 "indicators":{"quote":[{"open":[110,120],"high":[111,121],"low":[109,119],"close":[110.5,120.25],
                   "volume":[1,2]}]}}""");
        DailyHistory h = YahooProvider.dailyHistoryFromChart(chart);
        assertThat(h.points()).extracting(p -> p.c()).containsExactly(110.5, 120.25);
    }
}
