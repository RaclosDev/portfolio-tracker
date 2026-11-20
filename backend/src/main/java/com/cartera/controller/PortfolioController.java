package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.market.FundComposition;
import com.cartera.dto.portfolio.PortfolioDtos.CarteraView;
import com.cartera.dto.portfolio.PortfolioDtos.ImportRequest;
import com.cartera.dto.portfolio.PortfolioDtos.ImportResponse;
import com.cartera.dto.portfolio.PortfolioDtos.PortfolioHistory;
import com.cartera.dto.portfolio.PortfolioDtos.PortfolioQuotes;
import com.cartera.exception.ApiException;
import com.cartera.service.portfolio.OperationService;
import com.cartera.service.portfolio.PortfolioService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;

/** Cartera real: el registro con los precios de hoy, su valor día a día y la importación desde Excel. */
@RestController
@RequestMapping("/api/portfolio")
@RequiredArgsConstructor
public class PortfolioController {

    private final PortfolioService portfolio;
    private final OperationService operations;

    @GetMapping
    public CarteraView view(@AuthenticationPrincipal CurrentUser user,
                            @RequestParam(required = false) @Pattern(regexp = "1|true") String force,
                            @RequestParam(required = false) @Pattern(regexp = "1|true") String live) {
        return portfolio.view(user.id(), force != null,
                live != null ? MarketController.LIVE_MAX_AGE_MS : portfolio.defaultMaxAgeMs());
    }

    /** Solo precios y divisas, casi en directo: la cartera en pantalla los pide cada dos segundos. */
    @GetMapping("/quotes")
    public PortfolioQuotes quotes(@AuthenticationPrincipal CurrentUser user) {
        return portfolio.quotes(user.id(), MarketController.LIVE_MAX_AGE_MS);
    }

    @GetMapping("/history")
    public PortfolioHistory history(@AuthenticationPrincipal CurrentUser user, @RequestParam String from,
                                    @RequestParam String to) {
        return portfolio.history(user.id(), date("from", from), date("to", to));
    }

    /** Qué lleva dentro cada fondo o ETF en cartera, por ticker (null: ninguna fuente lo sabe). */
    @GetMapping("/composition")
    public Map<String, FundComposition> composition(@AuthenticationPrincipal CurrentUser user) {
        return portfolio.composition(user.id());
    }

    /** Añade movimientos de un Excel; los repetidos solo entran si se pide expresamente. */
    @PostMapping("/import")
    public ImportResponse importOperations(@AuthenticationPrincipal CurrentUser user,
                                           @Valid @RequestBody ImportRequest req) {
        return operations.importOperations(user.id(), req);
    }

    private static LocalDate date(String field, String value) {
        try {
            if (value.matches("\\d{4}-\\d{2}-\\d{2}")) return LocalDate.parse(value);
        } catch (DateTimeParseException ignored) {
            // Igual que un formato erróneo.
        }
        throw ApiException.badRequest(field + ": fecha AAAA-MM-DD no válida");
    }
}
