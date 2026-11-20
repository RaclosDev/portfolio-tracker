package com.cartera.service.market;

import com.cartera.dto.market.InstrumentHit;
import com.cartera.util.Html;
import com.cartera.util.Isin;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Buscador público de live.euronext.com (París, Ámsterdam, Milán, Bruselas, Lisboa, Dublín, Oslo). Encuentra por nombre
 * productos que onvista solo da por ISIN (p. ej. «swiss gold» → WisdomTree Physical Swiss Gold). Solo catálogo:
 * sus precios van cifrados, así que la bolsa y el precio salen de las demás fuentes.
 */
@Component
public class EuronextCatalog implements InstrumentCatalog {

    private static final String URL = "https://live.euronext.com/en/instrumentSearch/searchJSON?q=";
    /** Sección de la ficha → tipo. Índices, opciones y futuros no se siguen. */
    private static final Map<String, String> TYPES = Map.of("equities", "EQUITY", "etfs", "ETF", "etvs", "ETF", "funds", "MUTUALFUND");
    private static final Pattern SECTION = Pattern.compile("/product/([a-z-]+)/");
    private static final Pattern NAME = Pattern.compile("<span class=['\"]name['\"]>([\\s\\S]*?)</span>");

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();

    public EuronextCatalog(MarketHttp http) {
        this.http = http;
    }

    static List<InstrumentHit> parse(JsonNode data) {
        Map<String, InstrumentHit> hits = new LinkedHashMap<>();
        if (data == null || !data.isArray()) return List.of();
        for (JsonNode item : data) {
            JsonNode isin = item.get("isin");
            JsonNode link = item.get("link");
            JsonNode label = item.get("label");
            if (isin == null || !isin.isString() || link == null || !link.isString() || label == null || !label.isString()
                    || !Isin.isIsin(isin.asString())) continue;
            Matcher s = SECTION.matcher(link.asString());
            String type = s.find() ? TYPES.get(s.group(1)) : null;
            Matcher n = NAME.matcher(label.asString());
            String name = n.find() ? Html.text(n.group(1)) : "";
            if (type != null && !name.isEmpty()) hits.putIfAbsent(isin.asString(), new InstrumentHit(isin.asString(), name, type));
        }
        return List.copyOf(hits.values());
    }

    @Override
    public List<InstrumentHit> findInstruments(String query) {
        String q = query.trim();
        if (q.length() < 3 || q.length() > 100) return List.of();
        HttpResponse<String> res = http.raw(client, URL + MarketHttp.enc(q), Map.of("Accept", "application/json"));
        if (res.statusCode() / 100 != 2) throw new MarketSourceException("Euronext HTTP " + res.statusCode());
        return parse(http.readTree(res.body())).stream().limit(12).toList();
    }
}
