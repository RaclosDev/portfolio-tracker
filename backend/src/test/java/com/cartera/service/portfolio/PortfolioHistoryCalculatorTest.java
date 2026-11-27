package com.cartera.service.portfolio;

import com.cartera.dto.market.DailyHistoryResult;
import com.cartera.dto.market.PricePoint;
import com.cartera.dto.portfolio.PortfolioDtos.HistoryPoint;
import com.cartera.model.Instrument;
import com.cartera.model.Operation;
import com.cartera.model.OperationType;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PortfolioHistoryCalculatorTest {

    private static final UUID USER = UUID.randomUUID();
    private static long nextId = 1;

    private static Instrument instrument(String ticker, String symbol, String isin) {
        Instrument i = new Instrument(USER, ticker);
        i.setSymbol(symbol);
        i.setIsin(isin);
        i.setCurrency("EUR");
        return i;
    }

    private static Operation op(String date, String ticker, OperationType type, Double shares, Double splitRatio) {
        Operation o = new Operation();
        o.setId(nextId++);
        o.setUserId(USER);
        o.setDate(LocalDate.parse(date));
        o.setTicker(ticker);
        o.setType(type);
        o.setShares(shares);
        o.setSplitRatio(splitRatio);
        return o;
    }

    /** Un cierre por día entre las dos fechas, todos al mismo precio. */
    private static List<PricePoint> flat(String from, String to, double close) {
        List<PricePoint> out = new ArrayList<>();
        for (LocalDate d = LocalDate.parse(from); !d.isAfter(LocalDate.parse(to)); d = d.plusDays(1)) {
            out.add(new PricePoint(d.toString(), close));
        }
        return out;
    }

    private static HistoryPoint at(List<HistoryPoint> points, String date) {
        return points.stream().filter(p -> p.date().equals(date)).findFirst().orElseThrow();
    }

    @Test
    void aSplitDoesNotMakeTheCurveJumpBecauseClosesAreAlreadyAdjusted() {
        Instrument nvda = instrument("NVDA", "NVDA", null);
        // 10 acciones antes del split 10:1; los cierres ya vienen en la escala de hoy (110 antes, 110 después).
        List<Operation> ops = List.of(
                op("2024-06-01", "NVDA", OperationType.BUY, 10d, null),
                op("2024-06-10", "NVDA", OperationType.SPLIT, null, 10d));
        Map<String, DailyHistoryResult> prices = Map.of("NVDA",
                new DailyHistoryResult("EUR", flat("2024-05-30", "2024-06-14", 110), false));

        List<HistoryPoint> points = PortfolioHistoryCalculator.compute(ops, List.of(nvda), prices, Map.of(),
                LocalDate.parse("2024-06-03"), LocalDate.parse("2024-06-14"));

        // Antes y después del split el valor es el mismo: 10 acciones de entonces = 100 de hoy, a 110 € cada una.
        assertThat(at(points, "2024-06-05").valueEur()).isEqualTo(11_000d);
        assertThat(at(points, "2024-06-09").valueEur()).isEqualTo(11_000d);
        assertThat(at(points, "2024-06-10").valueEur()).isEqualTo(11_000d);
        assertThat(at(points, "2024-06-14").valueEur()).isEqualTo(11_000d);
        assertThat(points).allSatisfy(p -> assertThat(p.missing()).isEmpty());
    }

    @Test
    void sellingAfterASplitUsesTodaysScaleOnBothSides() {
        Instrument x = instrument("X", "X", null);
        List<Operation> ops = List.of(
                op("2024-06-01", "X", OperationType.BUY, 10d, null),
                op("2024-06-10", "X", OperationType.SPLIT, null, 2d),
                op("2024-06-12", "X", OperationType.SELL, 5d, null));
        Map<String, DailyHistoryResult> prices = Map.of("X",
                new DailyHistoryResult("EUR", flat("2024-05-30", "2024-06-14", 50), false));

        List<HistoryPoint> points = PortfolioHistoryCalculator.compute(ops, List.of(x), prices, Map.of(),
                LocalDate.parse("2024-06-03"), LocalDate.parse("2024-06-14"));

        assertThat(at(points, "2024-06-05").valueEur()).isEqualTo(1_000d); // 10 × 2 × 50
        assertThat(at(points, "2024-06-11").valueEur()).isEqualTo(1_000d); // 20 × 50
        assertThat(at(points, "2024-06-13").valueEur()).isEqualTo(750d);   // 15 × 50
    }

    @Test
    void sharesBoughtWithOneTickerAndSoldWithAnotherOfTheSameIsinAreOnePosition() {
        String isin = "IE00B4L5Y983";
        // Mismo ETF en dos bolsas: el que tiene símbolo de cotización es el canónico.
        Instrument a = instrument("IWDA", "IWDA.AS", isin);
        Instrument b = instrument("EUNL", null, isin);
        List<Operation> ops = List.of(
                op("2024-06-01", "EUNL", OperationType.BUY, 10d, null),
                op("2024-06-12", "IWDA", OperationType.SELL, 4d, null));
        Map<String, DailyHistoryResult> prices = Map.of("IWDA.AS",
                new DailyHistoryResult("EUR", flat("2024-05-30", "2024-06-14", 100), false));

        List<HistoryPoint> points = PortfolioHistoryCalculator.compute(ops, List.of(a, b), prices, Map.of(),
                LocalDate.parse("2024-06-03"), LocalDate.parse("2024-06-14"));

        assertThat(at(points, "2024-06-05").valueEur()).isEqualTo(1_000d);
        assertThat(at(points, "2024-06-13").valueEur()).isEqualTo(600d);
        assertThat(points).allSatisfy(p -> assertThat(p.missing()).isEmpty());
    }
}
