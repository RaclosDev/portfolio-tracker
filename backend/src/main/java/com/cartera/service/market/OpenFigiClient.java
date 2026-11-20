package com.cartera.service.market;

import com.cartera.util.Isin;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Búsqueda por ISIN: Yahoo no busca por ISIN, así que se traduce a tickers con OpenFIGI (servicio público y gratuito
 * de Bloomberg) y se pasan a la nomenclatura de Yahoo.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class OpenFigiClient {

    private static final String URL = "https://api.openfigi.com/v3/mapping";
    private static final Map<String, String> HEADERS = Map.of("User-Agent", "watchlist-app");
    /** OpenFIGI sin clave admite 10 ISIN por petición y 25 peticiones por minuto. */
    private static final int BATCH = 10;

    private final MarketHttp http;

    private record Figi(String ticker, String exchCode) {
    }

    /** Tickers de Yahoo candidatos para un ISIN, en orden de preferencia (máximo 8). */
    public List<String> candidates(String isin) {
        String code = isin.trim().toUpperCase(Locale.ROOT);
        JsonNode res;
        try {
            res = http.postJson(URL, List.of(Map.of("idType", "ID_ISIN", "idValue", code)), HEADERS);
        } catch (MarketSourceException e) {
            log.debug("OpenFIGI no contesta: {}", e.getMessage());
            return List.of();
        }
        List<String> home = Isin.home(code);
        Comparator<Figi> rank = Comparator.comparingInt(d -> {
            int i = home.indexOf(d.exchCode());
            return i >= 0 ? i : home.size() + Isin.suffixRank(d.exchCode());
        });
        Set<String> out = new LinkedHashSet<>();
        figis(res.path(0)).stream()
                .filter(d -> Isin.suffix(d.exchCode()) != null)
                .sorted(rank)
                .map(d -> Isin.toYahoo(d.ticker(), d.exchCode()))
                .forEach(out::add);
        return out.stream().limit(8).toList();
    }

    /**
     * Ticker con el que se conoce cada ISIN en su bolsa de casa (US4592001014 → IBM), sin sufijo de bolsa; null si
     * OpenFIGI no lo conoce. Los que no se han podido preguntar (límite, red) no salen en el resultado.
     */
    public Map<String, String> homeTickers(List<String> isins) {
        Map<String, String> out = new LinkedHashMap<>();
        for (int i = 0; i < isins.size(); i += BATCH) {
            List<String> batch = isins.subList(i, Math.min(isins.size(), i + BATCH));
            JsonNode results;
            try {
                results = http.postJson(URL,
                        batch.stream().map(isin -> Map.of("idType", "ID_ISIN", "idValue", isin)).toList(), HEADERS);
            } catch (RuntimeException e) {
                log.debug("OpenFIGI no contesta: {}", e.getMessage());
                break; // 429: se deja para la próxima vez
            }
            if (!results.isArray()) break;
            for (int j = 0; j < batch.size(); j++) {
                String isin = batch.get(j);
                List<Figi> data = figis(results.path(j));
                Figi best = Isin.home(isin).stream()
                        .map(e -> data.stream().filter(d -> d.exchCode().equals(e)).findFirst().orElse(null))
                        .filter(Objects::nonNull).findFirst()
                        .orElseGet(() -> data.stream().filter(d -> Isin.suffix(d.exchCode()) != null).findFirst()
                                .orElse(data.isEmpty() ? null : data.getFirst()));
                String ticker = best == null ? null : best.ticker().trim();
                out.put(isin, ticker == null || ticker.isEmpty() ? null : ticker);
            }
        }
        return out;
    }

    private static List<Figi> figis(JsonNode result) {
        List<Figi> out = new ArrayList<>();
        for (JsonNode d : result.path("data")) {
            String ticker = d.path("ticker").asString("");
            String exch = d.path("exchCode").asString("");
            if (!ticker.isEmpty() && !exch.isEmpty()) out.add(new Figi(ticker, exch));
        }
        return out;
    }
}
