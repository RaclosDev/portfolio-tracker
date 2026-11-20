package com.cartera.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.node.ObjectNode;

import java.util.List;

/**
 * Filas de un Excel o CSV. Cada una trae {@code symbol} y solo los campos que tenía el fichero:
 * sobre un valor que ya está en la lista se aplican como un PATCH.
 */
public record ImportRequest(@NotNull @NotEmpty @Size(max = 1000) List<ObjectNode> items) {
}
