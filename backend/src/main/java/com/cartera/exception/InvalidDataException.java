package com.cartera.exception;

import lombok.Getter;

import java.util.List;

/** Datos que no pasan la validación fuera de un {@code @Valid} (PATCH parciales, filas de una importación). */
@Getter
public class InvalidDataException extends RuntimeException {

    private final List<String> issues;

    public InvalidDataException(List<String> issues) {
        super("Revisa los datos enviados.");
        this.issues = issues;
    }
}
