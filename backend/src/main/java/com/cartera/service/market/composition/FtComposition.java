package com.cartera.service.market.composition;

import com.cartera.dto.market.FundHolding;
import com.cartera.service.market.MarketHttp;
import com.cartera.util.Isin;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * FT Markets: la tabla «Top 10 holdings» de la ficha de fondos y ETF. Sin ISIN los encuentra por el ticker de Yahoo
 * o el código de Morningstar, así que la composición no depende de Yahoo.
 */
@Component
@Order(4)
public class FtComposition implements CompositionSource {

    private static final String ORIGIN = "https://markets.ft.com/data";
    private static final List<String> MONTHS =
            List.of("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec");
    private static final Map<String, String> ENTITIES =
            Map.of("amp", "&", "quot", "\"", "apos", "'", "lt", "<", "gt", ">", "nbsp", " ");
    /** Bolsa de FT que corresponde al sufijo del ticker de Yahoo. */
    private static final Map<String, String> FT_EXCHANGE =
            Map.of("AS", "AEX", "L", "LSE", "DE", "GER", "MI", "MIL", "PA", "PAR", "SW", "SWX", "MC", "MCE");
    private static final Pattern START = Pattern.compile("Top 10 holdings\\s*</h2>");
    private static final Pattern ROW = Pattern.compile("<tr[\\s>]");
    private static final Pattern CELL = Pattern.compile("<td[^>]*>([\\s\\S]*?)</td>");
    private static final Pattern BR = Pattern.compile("<br\\s*/?>");
    private static final Pattern WEIGHT = Pattern.compile("^(\\d+(?:\\.\\d+)?)%$");
    private static final Pattern AS_OF = Pattern.compile("As of ([A-Z][a-z]{2}) (\\d{1,2}) (\\d{4})");
    private static final Pattern TAG = Pattern.compile("<[^>]*>");
    private static final Pattern DEC = Pattern.compile("&#(\\d+);");
    private static final Pattern HEX = Pattern.compile("(?i)&#x([0-9a-f]+);");
    private static final Pattern NAMED = Pattern.compile("(?i)&([a-z]+);");
    private static final Pattern ROOT = Pattern.compile("^[A-Z0-9]{2,12}$");
    private static final Pattern MORNINGSTAR = Pattern.compile("^0P[0-9A-Z]{8}$");

    private final MarketHttp http;
    private final HttpClient client = MarketHttp.noRedirectClient();

    public FtComposition(MarketHttp http) {
        this.http = http;
    }

    @Override
    public String id() {
        return "FT Markets";
    }

    /** Quita las etiquetas hasta que no quede ninguna: una sola pasada deja «<script>» al limpiar «<scr<b>ipt>». */
    private static String stripTags(String html) {
        String text = html;
        String prev;
        do {
            prev = text;
            text = TAG.matcher(text).replaceAll("");
        } while (!prev.equals(text));
        return text.replaceAll("[<>]", "");
    }

    private static String replace(Pattern p, String s, java.util.function.Function<Matcher, String> f) {
        Matcher m = p.matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) m.appendReplacement(sb, Matcher.quoteReplacement(f.apply(m)));
        m.appendTail(sb);
        return sb.toString();
    }

    static String decode(String html) {
        String s = stripTags(html);
        s = replace(DEC, s, m -> codePoint(m.group(1), 10, m.group()));
        s = replace(HEX, s, m -> codePoint(m.group(1), 16, m.group()));
        s = replace(NAMED, s, m -> ENTITIES.getOrDefault(m.group(1).toLowerCase(Locale.ROOT), m.group()));
        return s.trim();
    }

    private static String codePoint(String digits, int radix, String fallback) {
        try {
            int cp = Integer.parseInt(digits, radix);
            return Character.isValidCodePoint(cp) ? new String(Character.toChars(cp)) : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /** Tabla «Top 10 holdings» de la ficha de FT: empresa, su símbolo de FT y el peso. */
    static Result parse(String html) {
        Matcher start = START.matcher(html);
        if (!start.find()) return null;
        String section = html.substring(start.start(), Math.min(html.length(), start.start() + 60_000));
        List<FundHolding> holdings = new ArrayList<>();
        String[] rows = ROW.split(section);
        for (int r = 1; r < rows.length; r++) {
            String row = rows[r];
            List<String> cells = new ArrayList<>();
            Matcher c = CELL.matcher(row);
            while (c.find()) cells.add(c.group(1));
            if (cells.size() < 3 || !row.contains("mod-ui-table__cell--text")) continue;
            String[] parts = BR.split(cells.getFirst(), -1);
            String name = decode(parts.length > 0 ? parts[0] : "");
            String ticker = parts.length > 1 ? decode(parts[1]) : "";
            Matcher weight = WEIGHT.matcher(decode(cells.get(2)));
            if (name.isEmpty() || !weight.matches()) continue;
            holdings.add(new FundHolding(name, null, ticker.isEmpty() ? null : ticker, Double.parseDouble(weight.group(1)) / 100));
        }
        Matcher date = AS_OF.matcher(section);
        boolean found = date.find();
        if (!found) {
            date = AS_OF.matcher(html);
            found = date.find();
        }
        String asOf = null;
        if (found) {
            int month = MONTHS.indexOf(date.group(1).toLowerCase(Locale.ROOT)) + 1;
            if (month > 0) asOf = date.group(3) + "-" + String.format("%02d", month) + "-" + String.format("%02d", Integer.parseInt(date.group(2)));
        }
        return Holdings.clean(holdings, asOf);
    }

    private Result page(String kind, String ftSymbol) {
        String body = Holdings.fetch(http, client, ORIGIN + "/" + kind + "/tearsheet/holdings?s=" + MarketHttp.enc(ftSymbol),
                Map.of("Accept", "text/html"), id());
        return body == null ? null : parse(body);
    }

    private record Security(String symbol, String assetClass) {
    }

    private List<Security> search(String query) {
        JsonNode data = Holdings.fetchJson(http, client, ORIGIN + "/searchapi/searchsecurities?query=" + MarketHttp.enc(query),
                Map.of("Accept", "application/json"), id());
        JsonNode list = data == null ? null : data.path("data").get("security");
        List<Security> out = new ArrayList<>();
        if (list == null || !list.isArray()) return out;
        for (JsonNode s : list) out.add(new Security(Holdings.str(s, "symbol"), Holdings.str(s, "assetClass")));
        return out;
    }

    /** Los ETF se piden con su símbolo de bolsa (SWDA:LSE:GBX), que da el buscador de FT a partir del ISIN. */
    private String etfSymbol(String isin) {
        return search(isin).stream().filter(s -> "ETFs".equals(s.assetClass())).findFirst().map(Security::symbol).orElse(null);
    }

    /** Sin ISIN: el buscador reconoce el código de Morningstar de un fondo («0P00016YQ5.F») y el ticker de un ETF («VUSA.AS»). */
    private Result byTicker(String symbol) {
        String[] parts = symbol.toUpperCase(Locale.ROOT).split("\\.", -1);
        String root = parts[0];
        String suffix = parts.length > 1 ? parts[1] : null;
        if (!ROOT.matcher(root).matches()) return null;
        List<Security> list = search(root);
        if (MORNINGSTAR.matcher(root).matches()) {
            // La búsqueda es aproximada: solo vale el primer resultado, que es el del código exacto.
            Security first = list.isEmpty() ? null : list.getFirst();
            return first != null && "Funds".equals(first.assetClass()) && first.symbol() != null ? page("funds", first.symbol()) : null;
        }
        List<String> etfs = list.stream().filter(s -> "ETFs".equals(s.assetClass()) && s.symbol() != null)
                .map(Security::symbol).filter(s -> s.startsWith(root + ":")).toList();
        String exchange = suffix != null ? FT_EXCHANGE.get(suffix) : null;
        String etf = etfs.stream().filter(s -> exchange != null && exchange.equals(s.split(":", -1)[1])).findFirst()
                .orElse(etfs.isEmpty() ? null : etfs.getFirst());
        if (etf != null) return page("etfs", etf);
        String fund = list.stream().filter(s -> "Funds".equals(s.assetClass()) && root.equals(s.symbol()))
                .map(Security::symbol).findFirst().orElse(null);
        return fund != null ? page("funds", fund) : null;
    }

    @Override
    public Result getComposition(Ref ref) {
        String symbol = ref.symbol();
        String isin = ref.isin();
        String own = symbol != null && symbol.toUpperCase(Locale.ROOT).startsWith("FT:") ? symbol.substring(3).toUpperCase(Locale.ROOT) : null;
        String[] ownParts = own != null ? own.split(":") : new String[0];
        boolean ownIsin = own != null && Isin.isIsin(ownParts[0]);
        if (own != null && !ownIsin) {
            Result direct = page("etfs", own);
            if (direct == null) direct = page("funds", own);
            if (direct != null || isin == null) return direct;
        }
        if (isin == null) {
            if (own != null) return page("funds", own);
            return symbol != null && !symbol.contains(":") ? byTicker(symbol) : null;
        }
        String currency = ownIsin && ownParts.length > 1 && !ownParts[1].isEmpty() ? ownParts[1] : "EUR";
        Result fund = page("funds", isin + ":" + currency);
        if (fund != null) return fund;
        String etf = etfSymbol(isin);
        return etf != null ? page("etfs", etf) : null;
    }
}
