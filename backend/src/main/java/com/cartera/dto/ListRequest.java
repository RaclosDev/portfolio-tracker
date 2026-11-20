package com.cartera.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ListRequest(@NotBlank @Size(max = 60) String name) {

    public ListRequest {
        name = name == null ? null : name.trim();
    }
}
