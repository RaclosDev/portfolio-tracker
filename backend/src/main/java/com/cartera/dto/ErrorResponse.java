package com.cartera.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/** Cuerpo de todas las respuestas de error de la API. {@code issues} solo aparece en errores de validación. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(String error, List<String> issues) {

    public ErrorResponse(String error) {
        this(error, null);
    }
}
