package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.CandlesResult;
import com.cartera.dto.market.DividendsResult;
import com.cartera.dto.market.HistoryRange;
import com.cartera.dto.market.HistoryResult;
import com.cartera.dto.market.InstrumentHit;
import com.cartera.dto.market.IntradayInterval;
import com.cartera.dto.market.Listing;
import com.cartera.dto.market.Quote;
import com.cartera.dto.market.SymbolSearchResult;
import com.cartera.exception.ApiException;
import com.cartera.service.SettingsService;
import com.cartera.service.market.MarketService;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Datos de mercado: búsqueda, cotizaciones, consenso, tipos de cambio, históricos y velas. */
@RestController
@RequestMapping("/api/market")
@RequiredArgsConstructor
public class MarketController {

    /** Caché de precios de lo que está en pantalla en directo (se pide cada dos segundos). */
    public static final long LIVE_MAX_AGE_MS = 1_500;
    private static final ZoneId MADRID = ZoneId.of("Europe/Madrid");

    private final MarketService market;
    private final SettingsService settings;

    @GetMapping("/search")
    public List<SymbolSearchResult> search(@RequestParam @Size(min = 1, max = 60) String q) {
        return market.search(requireText(q));
    }

    /** Buscador en dos pasos: primero qué producto (por nombre, ISIN o WKN), luego en qué bolsa seguirlo. */
    @GetMapping("/instruments")
    public List<InstrumentHit> instruments(@RequestParam @Size(min = 1, max = 60) String q) {
        return market.instruments(requireText(q));
    }

    @GetMapping("/listings")
    public List<Listing> listings(@RequestParam String isin) {
        String code = isin.trim().toUpperCase(Locale.ROOT);
        if (!code.matches("[A-Z]{2}[A-Z0-9]{9}\\d")) throw ApiException.badRequest("isin: no es un ISIN válido");
        return market.listings(code);
    }

    /** Cotización casi en directo del gráfico abierto: caché de 1,5 s en vez de la normal. */
    @GetMapping("/live/{symbol}")
    public Quote live(@PathVariable @Size(min = 1, max = 32) String symbol) {
        return quoteOf(symbol.toUpperCase(Locale.ROOT), LIVE_MAX_AGE_MS);
    }

    @GetMapping("/quote/{symbol}")
    public Quote quote(@PathVariable @Size(min = 1, max = 32) String symbol) {
        return quoteOf(symbol.toUpperCase(Locale.ROOT), Long.MAX_VALUE);
    }

    /** Consenso de analistas de un valor que aún no está en ninguna lista (buscador de la cabecera). */
    @GetMapping("/targets/{symbol}")
    public Map<String, AnalystTargets> targets(@PathVariable @Size(min = 1, max = 32) String symbol) {
        String sym = symbol.toUpperCase(Locale.ROOT);
        Quote quote = market.getQuotes(List.of(sym)).get(sym);
        AnalystTargets targets = quote == null || MarketService.NO_ANALYST_COVERAGE.contains(String.valueOf(quote.quoteType()))
                ? null : market.getTargets(List.of(sym), false).get(sym);
        Map<String, AnalystTargets> out = new java.util.HashMap<>();
        out.put("targets", targets);
        return out;
    }

    /** Varias cotizaciones de una vez (los símbolos que no existen no vienen en la respuesta). */
    @GetMapping("/quotes")
    public List<Quote> quotes(@RequestParam @Size(min = 1, max = 4000) String symbols) {
        return new ArrayList<>(market.getQuotes(symbolList(symbols, 300)).values());
    }

    @GetMapping("/fx")
    public Map<String, Double> fx(@AuthenticationPrincipal CurrentUser user,
                                  @RequestParam @Size(min = 1, max = 100) String currencies,
                                  @RequestParam(required = false) @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}") String date,
                                  // La cartera pide en euros; la lista, en su divisa base.
                                  @RequestParam(required = false) @Pattern(regexp = "[A-Z]{3}") String base) {
        LocalDate day = date != null ? LocalDate.parse(date) : null;
        LocalDate today = LocalDate.now(MADRID);
        String baseCurrency = base != null ? base : settings.get(user.id()).baseCurrency();
        return market.getFxRates(baseCurrency, Arrays.asList(currencies.split(",")),
                day != null && day.isBefore(today) ? day : null, null);
    }

    @GetMapping("/history/{symbol}")
    public HistoryResult history(@PathVariable @Size(min = 1, max = 32) String symbol,
                                 @RequestParam(defaultValue = "1y") @Pattern(regexp = "1m|3m|6m|1y|5y") String range) {
        return market.getHistory(symbol.toUpperCase(Locale.ROOT), HistoryRange.of(range));
    }

    /** Velas de la ficha: diarias (cinco años, con la sesión de hoy en directo) o intradía. */
    @GetMapping("/candles/{symbol}")
    public CandlesResult candles(@PathVariable @Size(min = 1, max = 32) String symbol,
                                 @RequestParam(defaultValue = "1d") @Pattern(regexp = "1d|1m|5m|15m|30m|1h|4h") String interval,
                                 @RequestParam(defaultValue = "5y") @Pattern(regexp = "5y|max") String range) {
        String sym = symbol.toUpperCase(Locale.ROOT);
        boolean daily = interval.equals("1d");
        // Toda la historia (solo diaria) se pide aparte, cuando el gráfico se aleja más allá de los cinco años.
        if (daily && range.equals("max")) return market.getAllCandles(sym);
        return market.getCandles(sym, daily ? null : IntradayInterval.of(interval));
    }

    /** Dividendos del valor (fecha ex e importe), para ajustar las velas del gráfico si se pide. */
    @GetMapping("/dividends/{symbol}")
    public DividendsResult dividends(@PathVariable @Size(min = 1, max = 32) String symbol) {
        return market.getDividends(symbol.toUpperCase(Locale.ROOT));
    }

    @GetMapping("/sparklines")
    public Map<String, List<Double>> sparklines(@RequestParam @Size(min = 1, max = 2000) String symbols,
                                                @RequestParam(defaultValue = "3m") @Pattern(regexp = "3m|1y") String range) {
        return market.getSparklines(symbolList(symbols, 100), HistoryRange.of(range));
    }

    private Quote quoteOf(String sym, long maxAgeMs) {
        Quote quote = market.getQuotes(List.of(sym), false, maxAgeMs).get(sym);
        if (quote == null) throw ApiException.notFound("Símbolo " + sym + " no encontrado en " + market.providerId());
        return quote;
    }

    private static String requireText(String q) {
        String text = q.trim();
        if (text.isEmpty()) throw ApiException.badRequest("q: no puede estar vacío");
        return text;
    }

    private static List<String> symbolList(String csv, int max) {
        Set<String> out = new LinkedHashSet<>();
        for (String s : csv.split(",")) {
            String sym = s.trim().toUpperCase(Locale.ROOT);
            if (!sym.isEmpty()) out.add(sym);
            if (out.size() == max) break;
        }
        return new ArrayList<>(out);
    }
}
