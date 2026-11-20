package com.cartera.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Un valor recién abierto desde el buscador. Como antes, un nombre, bolsa o tipo que no cabe
 * se descarta en vez de rechazar la visita.
 */
public record VisitedRequest(
        @NotBlank @Size(max = 32) String symbol,
        String name,
        String exchange,
        String type,
        @Size(max = 12) String isin) {
}
