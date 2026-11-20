package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.portfolio.OperationResponse;
import com.cartera.dto.portfolio.PortfolioDtos.BulkBrokerRequest;
import com.cartera.dto.portfolio.PortfolioDtos.BulkBrokerResponse;
import com.cartera.service.portfolio.OperationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** Registro de operaciones de la cartera. Cada cambio se valida sobre el registro completo. */
@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
public class OperationController {

    private final OperationService operations;

    /** Alta: {@code {operation, instrument?}}. Crea el valor si es nuevo; falla si el registro deja de cuadrar. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OperationResponse create(@AuthenticationPrincipal CurrentUser user, @RequestBody JsonNode body) {
        return operations.create(user.id(), body);
    }

    /** Cambio: {@code {operation, instrument?}} o la operación sola. */
    @PutMapping("/{id}")
    public OperationResponse update(@AuthenticationPrincipal CurrentUser user, @PathVariable @Positive Long id,
                                    @RequestBody JsonNode body) {
        return operations.update(user.id(), id, body);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal CurrentUser user, @PathVariable @Positive Long id) {
        operations.delete(user.id(), id);
    }

    /** Cambia el bróker de varias operaciones a la vez. */
    @PostMapping("/broker")
    public BulkBrokerResponse setBroker(@AuthenticationPrincipal CurrentUser user,
                                        @Valid @RequestBody BulkBrokerRequest req) {
        return operations.setBroker(user.id(), req);
    }
}
