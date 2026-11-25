package com.cartera.service.market;

import com.cartera.dto.market.Candle;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CandleVolumeTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void laVelaDeHoyDeFinancialHubLlevaElVolumenDelDia() {
        JsonNode q = JSON.readTree("""
                {"price":10.028,"tradingDate":"2026-11-25","currency":"EUR","volume":21102096,
                 "day":{"open":10.404,"high":10.54,"low":10.024}}""");
        Candle live = FinancialHubProvider.liveCandle(q, "EUR");
        assertThat(live).isNotNull();
        assertThat(live.v()).isEqualTo(21102096d);
    }

    @Test
    void sinVolumenONegativoQuedaNulo() {
        assertThat(FinancialHubProvider.volume(null)).isNull();
        assertThat(FinancialHubProvider.volume(JSON.readTree("-5"))).isNull();
        assertThat(FinancialHubProvider.volume(JSON.readTree("0"))).isEqualTo(0d);
    }

    @Test
    void lasVelasDeYahooLlevanSuVolumen() {
        JsonNode chart = JSON.readTree("""
                {"meta":{"currency":"EUR","exchangeTimezoneName":"Europe/Madrid"},
                 "timestamp":[1763974800,1764061200],
                 "indicators":{"quote":[{"open":[10,10.4],"high":[10.5,10.6],"low":[9.9,10.1],"close":[10.4,10.2],
                   "volume":[18612987,null]}]}}""");
        List<Candle> candles = YahooProvider.candlesFromChart(chart);
        assertThat(candles).extracting(Candle::v).containsExactly(18612987d, null);
    }

    @Test
    void lasVelasDeYahooPierdenElRuidoDelFloat() {
        JsonNode chart = JSON.readTree("""
                {"meta":{"currency":"EUR","exchangeTimezoneName":"Europe/Madrid"},
                 "timestamp":[1764061200],
                 "indicators":{"quote":[{"open":[22.790000915527344],"high":[22.950000762939453],
                   "low":[22.709999084472656],"close":[22.719999313354492],"volume":[7464774]}]}}""");
        Candle c = YahooProvider.candlesFromChart(chart).getFirst();
        assertThat(List.of(c.o(), c.h(), c.l(), c.c())).containsExactly(22.79, 22.95, 22.71, 22.72);
        assertThat(YahooProvider.clean(1392.219970703125)).isEqualTo(1392.22);
        assertThat(YahooProvider.clean(0.0123456789)).isEqualTo(0.01234568);
    }
}
