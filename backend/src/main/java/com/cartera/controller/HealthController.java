package com.cartera.controller;

import com.cartera.service.market.MarketService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryPoolMXBean;
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
        out.put("memory", memory());
        return out;
    }

    /** Memoria de la JVM en MB: para ver qué ocupa antes de tocar los límites del contenedor. */
    static Map<String, Object> memory() {
        Map<String, Object> out = new LinkedHashMap<>();
        var mem = ManagementFactory.getMemoryMXBean();
        out.put("heapUsedMb", mb(mem.getHeapMemoryUsage().getUsed()));
        out.put("heapCommittedMb", mb(mem.getHeapMemoryUsage().getCommitted()));
        out.put("heapMaxMb", mb(mem.getHeapMemoryUsage().getMax()));
        out.put("nonHeapCommittedMb", mb(mem.getNonHeapMemoryUsage().getCommitted()));
        for (MemoryPoolMXBean pool : ManagementFactory.getMemoryPoolMXBeans()) {
            if (pool.getName().equals("Metaspace")) out.put("metaspaceMb", mb(pool.getUsage().getCommitted()));
        }
        out.put("threads", ManagementFactory.getThreadMXBean().getThreadCount());
        return out;
    }

    private static long mb(long bytes) {
        return bytes < 0 ? -1 : bytes / (1024 * 1024);
    }
}
