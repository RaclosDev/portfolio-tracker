package com.cartera.service.market.composition;

import com.cartera.dto.market.FundHolding;
import com.cartera.service.market.MarketHttp;
import com.cartera.service.market.MarketSourceException;
import com.cartera.util.Isin;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Utilidades comunes de las fuentes de composición. */
final class Holdings {

    /** Las fuentes que solo dan las mayores posiciones: con 25 basta. */
    static final int MAX_HOLDINGS = 25;
    /** Con la cartera completa: un MSCI World son ~1.300 posiciones; de las 2.000 en adelante cada una pesa ~0 %. */
    static final int MAX_FULL_HOLDINGS = 2000;
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

    private Holdings() {
    }

    /** Descarta pesos imposibles y repetidos; null si lo que queda no parece una composición (suma más del 100 %). */
    static CompositionSource.Result clean(List<FundHolding> raw, String asOf, int max) {
        Set<String> seen = new HashSet<>();
        List<FundHolding> holdings = new ArrayList<>();
        for (FundHolding h : raw) {
            if (h.name() == null || h.name().isEmpty()) continue;
            String key = h.isin() != null ? h.isin() : h.name().toLowerCase(Locale.ROOT);
            if (!Double.isFinite(h.weight()) || h.weight() <= 0 || h.weight() > 1 || !seen.add(key)) continue;
            holdings.add(h.withWeight(Math.round(h.weight() * 1e6) / 1e6));
        }
        holdings.sort(Comparator.comparingDouble(FundHolding::weight).reversed());
        List<FundHolding> top = holdings.subList(0, Math.min(max, holdings.size()));
        if (top.isEmpty() || top.stream().mapToDouble(FundHolding::weight).sum() > 1.02) return null;
        return new CompositionSource.Result(List.copyOf(top), asOf != null && DATE.matcher(asOf).matches() ? asOf : null);
    }

    static CompositionSource.Result clean(List<FundHolding> raw, String asOf) {
        return clean(raw, asOf, MAX_HOLDINGS);
    }

    /** Texto recortado del campo, o null si no es un texto con contenido. */
    static String str(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        if (v == null || !v.isString()) return null;
        String s = v.asString().trim();
        return s.isEmpty() ? null : s;
    }

    static Double num(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v != null && v.isNumber() ? v.asDouble() : null;
    }

    static String isinOrNull(JsonNode n, String field) {
        String s = str(n, field);
        return s != null && Isin.isIsin(s) ? s.toUpperCase(Locale.ROOT) : null;
    }

    /** Cuerpo de la respuesta; null si la fuente no conoce lo pedido (404). */
    static String fetch(MarketHttp http, HttpClient client, String url, Map<String, String> headers, String source) {
        HttpResponse<String> res = http.raw(client, url, headers);
        if (res.statusCode() == 404) return null;
        if (res.statusCode() / 100 != 2) throw new MarketSourceException(source + " HTTP " + res.statusCode());
        return res.body();
    }

    static JsonNode fetchJson(MarketHttp http, HttpClient client, String url, Map<String, String> headers, String source) {
        String body = fetch(http, client, url, headers, source);
        return body == null ? null : http.readTree(body);
    }
}
