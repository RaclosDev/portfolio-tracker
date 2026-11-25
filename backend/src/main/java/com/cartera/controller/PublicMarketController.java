package com.cartera.controller;

import com.cartera.dto.market.Candle;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.service.market.DemoPayload;
import com.cartera.service.market.PublicMarketService;
import com.cartera.service.market.PublicMarketService.Snapshot;
import lombok.RequiredArgsConstructor;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;
import java.util.Locale;

/** Precios reales sin sesión para la portada y la demo; solo valores de una lista fija. */
@RestController
@RequestMapping("/api/public/market")
@RequiredArgsConstructor
public class PublicMarketController {

    private final PublicMarketService market;
    private final DemoPayload payload;

    @GetMapping("/landing")
    public ResponseEntity<Snapshot> landing() {
        return cached(market.landing());
    }

    /** Cotizaciones y velas de cinco años, ya en JSON (y en gzip si el navegador lo acepta). */
    @GetMapping("/demo")
    public ResponseEntity<byte[]> demo(@RequestHeader(value = HttpHeaders.ACCEPT_ENCODING, required = false) String encoding) {
        return encoded(payload.full(), encoding);
    }

    /** Solo las cotizaciones de la demo: lo que necesita su primera pantalla, sin las velas de cinco años. */
    @GetMapping("/demo/quotes")
    public ResponseEntity<byte[]> demoQuotes(@RequestHeader(value = HttpHeaders.ACCEPT_ENCODING, required = false) String encoding) {
        return encoded(payload.quotes(), encoding);
    }

    /** Velas intradía reales para la ficha de la demo; solo valores de su catálogo. */
    @GetMapping("/demo/candles/{symbol}")
    public ResponseEntity<List<Candle>> demoCandles(@PathVariable @Size(min = 1, max = 32) String symbol,
                                                    @RequestParam @Pattern(regexp = "1m|5m|15m|30m|1h|4h") String interval) {
        String sym = symbol.toUpperCase(Locale.ROOT);
        if (!PublicMarketService.DEMO.contains(sym)) return ResponseEntity.notFound().build();
        List<Candle> candles = market.demoIntraday(sym, IntradayInterval.of(interval));
        if (candles.isEmpty()) return ResponseEntity.noContent().build();
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(1)).cachePublic()).body(candles);
    }

    /** Tomcat no vuelve a comprimir una respuesta que ya lleva Content-Encoding. */
    private static ResponseEntity<byte[]> encoded(DemoPayload.Encoded e, String acceptEncoding) {
        boolean gzip = acceptEncoding != null && acceptEncoding.toLowerCase(Locale.ROOT).contains("gzip");
        ResponseEntity.BodyBuilder res = ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic())
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.VARY, HttpHeaders.ACCEPT_ENCODING);
        if (gzip) res.header(HttpHeaders.CONTENT_ENCODING, "gzip");
        return res.body(gzip ? e.gzip() : e.json());
    }

    private static ResponseEntity<Snapshot> cached(Snapshot s) {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic()).body(s);
    }
}
