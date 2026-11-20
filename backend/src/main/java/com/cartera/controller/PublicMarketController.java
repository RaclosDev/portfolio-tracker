package com.cartera.controller;

import com.cartera.service.market.PublicMarketService;
import com.cartera.service.market.PublicMarketService.Snapshot;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

/** Precios reales sin sesión para la portada y la demo; solo valores de una lista fija. */
@RestController
@RequestMapping("/api/public/market")
@RequiredArgsConstructor
public class PublicMarketController {

    private final PublicMarketService market;

    @GetMapping("/landing")
    public ResponseEntity<Snapshot> landing() {
        return cached(market.landing());
    }

    @GetMapping("/demo")
    public ResponseEntity<Snapshot> demo() {
        return cached(market.demo());
    }

    private static ResponseEntity<Snapshot> cached(Snapshot s) {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic()).body(s);
    }
}
