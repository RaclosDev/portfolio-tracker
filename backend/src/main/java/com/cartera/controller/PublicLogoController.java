package com.cartera.controller;

import com.cartera.service.market.FinancialHubProvider;
import com.cartera.util.Isin;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.Duration;

/**
 * Logo de un valor por su ISIN: redirige al SVG de Financial Hub, la misma fuente que los precios. Sin sesión,
 * porque lo pide una etiqueta {@code <img>}; solo dice qué logo tiene un ISIN público.
 */
@Slf4j
@RestController
@RequestMapping("/api/public/logo")
@RequiredArgsConstructor
public class PublicLogoController {

    private final FinancialHubProvider financialHub;

    @GetMapping("/{isin}")
    public ResponseEntity<Void> logo(@PathVariable String isin) {
        if (!Isin.isIsin(isin)) return ResponseEntity.notFound().build();
        String url;
        try {
            url = financialHub.logoUrl(isin);
        } catch (RuntimeException e) {
            log.debug("Logo de {} no disponible: {}", isin, e.getMessage());
            // Fallo pasajero (límite de la API): el navegador lo reintenta pronto.
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).cacheControl(CacheControl.noStore()).build();
        }
        if (url == null) {
            return ResponseEntity.notFound().cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic()).build();
        }
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(7)).cachePublic()).build();
    }
}
