package com.cartera.controller;

import com.cartera.service.market.MarketService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/** Comprobación de vida que usan el frontend (aviso sin conexión y de nueva versión) y el monitor externo. */
@RestController
public class HealthController {

    private final MarketService market;
    private final String version;

    public HealthController(MarketService market, @Value("${app.version}") String version) {
        this.market = market;
        this.version = version.matches("[0-9a-f]{8,40}") ? version.substring(0, 7) : version;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("provider", market.providerId());
        out.put("version", version);
        out.put("market", market.diagnostics());
        return out;
    }
}
