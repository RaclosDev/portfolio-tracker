package com.cartera.service.market;

import com.cartera.dto.market.Candle;
import com.cartera.dto.market.PricePoint;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FtAuctionCloseTest {

    @Test
    void mismoValorEnLaMismaBolsaDeYahoo() {
        assertThat(FtProvider.yahooAuctionSymbol("RARE:MIL:EUR")).isEqualTo("RARE.MI");
        assertThat(FtProvider.yahooAuctionSymbol("ITX:MCE")).isEqualTo("ITX.MC");
        assertThat(FtProvider.yahooAuctionSymbol("GZUR:GER:EUR")).isNull(); // sin corrección configurada
        assertThat(FtProvider.yahooAuctionSymbol("IE00B03HCZ61:EUR")).isNull(); // fondo
    }

    @Test
    void cambiaElCierreDeFtPorElDeLaSubastaDelMismoDia() {
        List<PricePoint> ft = List.of(new PricePoint("2026-11-18", 35.9), new PricePoint("2026-11-19", 35.575),
                new PricePoint("2026-11-20", 34.165));
        List<PricePoint> out = FtProvider.withAuctionCloses(ft, Map.of("2026-11-19", 35.575, "2026-11-20", 34.045));
        assertThat(out).containsExactly(new PricePoint("2026-11-18", 35.9), new PricePoint("2026-11-19", 35.575),
                new PricePoint("2026-11-20", 34.045));
    }

    @Test
    void dejaElDeFtSiYahooDaOtraCosa() {
        List<PricePoint> ft = List.of(new PricePoint("2026-11-20", 34.165));
        assertThat(FtProvider.withAuctionCloses(ft, Map.of("2026-11-20", 51.55))).isEqualTo(ft);
        assertThat(FtProvider.withAuctionCloses(ft, Map.of())).isEqualTo(ft);
    }

    @Test
    void velasDeYahooSiCasanConFtMasLaSesionDeHoy() {
        List<Candle> y = List.of(new Candle("2026-11-19", 35.8, 36.2, 35.1, 35.575),
                new Candle("2026-11-20", 35.5, 35.9, 33.8, 34.045));
        List<PricePoint> ft = List.of(new PricePoint("2026-11-19", 35.575), new PricePoint("2026-11-20", 34.165),
                new PricePoint("2026-11-23", 34.5));
        assertThat(FtProvider.withFtSession(y, ft)).containsExactly(y.get(0), y.get(1),
                new Candle("2026-11-23", 34.045, 34.5, 34.045, 34.5));
        assertThat(FtProvider.withFtSession(y, ft.subList(0, 2))).isEqualTo(y);
    }

    @Test
    void sinVelasSiYahooNoCasaOEstaAtrasado() {
        List<Candle> y = List.of(new Candle("2026-11-20", 51, 52, 50, 51.55));
        assertThat(FtProvider.withFtSession(y, List.of(new PricePoint("2026-11-20", 34.165)))).isEmpty();
        List<Candle> viejas = List.of(new Candle("2026-11-18", 35.5, 36, 35, 35.9));
        assertThat(FtProvider.withFtSession(viejas, List.of(new PricePoint("2026-11-18", 35.9),
                new PricePoint("2026-11-19", 35.575), new PricePoint("2026-11-20", 34.165)))).isEmpty();
        assertThat(FtProvider.withFtSession(List.of(), List.of(new PricePoint("2026-11-20", 34.165)))).isEmpty();
    }
}
