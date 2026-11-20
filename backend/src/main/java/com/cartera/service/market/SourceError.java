package com.cartera.service.market;

/** Último fallo de una fuente, para el diagnóstico de /api/health. */
public record SourceError(String at, String message) {
}
