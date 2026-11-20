package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.portfolio.InstrumentResponse;
import com.cartera.service.portfolio.OperationService;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Datos de un valor de la cartera (cotización, nombre, ISIN, notas…). */
@RestController
@RequestMapping("/api/instruments")
@RequiredArgsConstructor
public class InstrumentController {

    private final OperationService operations;

    /** Cambio parcial: solo los campos que llegan. */
    @PutMapping("/{ticker}")
    public InstrumentResponse update(@AuthenticationPrincipal CurrentUser user,
                                     @PathVariable @Size(min = 1, max = 32) String ticker,
                                     @RequestBody JsonNode patch) {
        return operations.updateInstrument(user.id(), ticker, patch);
    }
}
