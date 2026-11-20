package com.cartera.dto.portfolio;

import com.cartera.dto.market.Quote;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Map;

/** Peticiones y respuestas pequeñas de la cartera. */
public final class PortfolioDtos {

    private PortfolioDtos() {
    }

    /** La cartera en pantalla: el registro completo y los precios de lo que sigue abierto. */
    public record CarteraView(List<InstrumentResponse> instruments, List<OperationResponse> operations,
                              Map<String, Quote> quotes, Map<String, Double> fx, List<String> fxStale,
                              String generatedAt, String throttledUntil) {
    }

    /** Lo que cambia de {@link CarteraView} entre dos refrescos en directo: sin operaciones ni instrumentos. */
    public record PortfolioQuotes(Map<String, Quote> quotes, Map<String, Double> fx, List<String> fxStale,
                                  String generatedAt, String throttledUntil) {
    }

    /** Cambia el bróker de varias operaciones a la vez. */
    public record BulkBrokerRequest(@NotEmpty @Size(max = 5000) List<@NotNull @Positive Long> ids,
                                    @Size(max = 40) String broker, Boolean needsReview) {
        public BulkBrokerRequest {
            broker = broker == null ? null : broker.trim();
            needsReview = needsReview != null && needsReview;
        }
    }

    public record BulkBrokerResponse(int updated) {
    }

    /** Añade movimientos de un Excel; los duplicados solo entran si se confirma expresamente. */
    public record ImportRequest(@NotNull @Size(max = 500) List<@Valid @NotNull InstrumentRequest> instruments,
                                @NotNull @Size(min = 1, max = 20_000) List<@Valid @NotNull OperationRequest> operations,
                                Boolean allowDuplicates) {
    }

    public record ImportResponse(int imported, int skipped, Long savedTo) {
    }

    public record HistoryPoint(String date, Double valueEur, Double constantFxEur, Double fxEffectEur,
                               Double startingValueEur, Double resultEur, double purchasesEur, double salesEur,
                               double incomeEur, List<String> missing) {
    }

    public record ExcludedInstrument(String ticker, String name) {
    }

    public record AvailableHistory(List<HistoryPoint> points, int included, List<ExcludedInstrument> excluded) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PortfolioHistory(String from, String to, List<HistoryPoint> points, boolean stale,
                                   List<String> missing, AvailableHistory available) {
    }
}
