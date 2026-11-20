package com.cartera.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Comprobación de vida que usan el frontend (aviso sin conexión) y el monitor externo. */
@RestController
public class HealthController {

    @GetMapping("/api/health")
    public Map<String, Boolean> health() {
        return Map.of("ok", true);
    }
}
