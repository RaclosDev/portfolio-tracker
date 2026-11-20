package com.cartera.util;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Formatos de símbolo de las fuentes que no son Yahoo. */
public final class MarketSymbols {

    /** Bolsas alemanas que cotiza onvista: XETRA:IE00B4L5Y983. */
    public static final Set<String> VENUES = Set.of("XETRA", "TRADEGATE", "FRANKFURT", "GETTEX", "LSX", "STUTTGART");
    private static final Pattern VENUE_SYMBOL =
            Pattern.compile("^(" + String.join("|", VENUES) + "):([A-Z]{2}[A-Z0-9]{9}\\d)$");
    private static final Pattern FT_SYMBOL = Pattern.compile("^FT:([A-Z0-9][A-Z0-9.:-]{0,27})$");
    private static final Set<String> FUND_TYPES = Set.of("ETF", "MUTUALFUND", "FUND");

    private MarketSymbols() {
    }

    public static boolean isVenueSymbol(String symbol) {
        return VENUE_SYMBOL.matcher(upper(symbol)).matches();
    }

    /** Lo que sigue a «FT:» o null si el símbolo no es de Financial Times. */
    public static String parseFtSymbol(String symbol) {
        Matcher m = FT_SYMBOL.matcher(upper(symbol));
        return m.matches() ? m.group(1) : null;
    }

    public static boolean isFundType(String type) {
        return type != null && FUND_TYPES.contains(type.toUpperCase(Locale.ROOT));
    }

    /** Bolsa (MIC) de cada sufijo de Yahoo y mercado de FT, para comparar cotizaciones de fuentes distintas. */
    private static final Map<String, String> TICKER_MIC = Map.ofEntries(
            Map.entry("DE", "XETR"), Map.entry("GER", "XETR"), Map.entry("AS", "XAMS"), Map.entry("AEX", "XAMS"),
            Map.entry("L", "XLON"), Map.entry("LSE", "XLON"), Map.entry("MI", "XMIL"), Map.entry("MIL", "XMIL"),
            Map.entry("PA", "XPAR"), Map.entry("PAR", "XPAR"), Map.entry("SW", "XSWX"), Map.entry("SWX", "XSWX"),
            Map.entry("MC", "XMAD"), Map.entry("MCE", "XMAD"));
    private static final Pattern PLAIN_TICKER = Pattern.compile("^([A-Z0-9-]+)(?:\\.([A-Z]+))?$");

    /** Raíz del ticker, bolsa y divisa (si el símbolo la dice) de un símbolo de Yahoo o de FT. */
    public record Ticker(String root, String mic, String currency) {
    }

    /** ISIN escrito dentro de un símbolo (XETRA:IE00B4L5Y983, FT:IE00B4L5Y983:EUR) o el propio ISIN. */
    public static String isinInSymbol(String symbol) {
        if (symbol == null) return null;
        return Arrays.stream(upper(symbol).split(":")).filter(p -> Isin.PATTERN.matcher(p).matches())
                .findFirst().orElse(null);
    }

    /** FT:SEC0:GER:EUR → SEC0/XETR/EUR; CHIP.PA → CHIP/XPAR; AAPL → AAPL sin bolsa. */
    public static Ticker tickerOf(String symbol) {
        String s = upper(symbol);
        if (s.isEmpty()) return null;
        if (s.startsWith("FT:")) {
            String[] parts = s.substring(3).split(":", -1);
            if (parts[0].isEmpty()) return null;
            String market = parts.length > 1 ? parts[1] : "";
            String currency = parts.length > 2 && !parts[2].isEmpty() ? parts[2] : null;
            return new Ticker(parts[0], TICKER_MIC.get(market), currency);
        }
        Matcher m = PLAIN_TICKER.matcher(s);
        if (!m.matches()) return null;
        return new Ticker(m.group(1), m.group(2) == null ? null : TICKER_MIC.get(m.group(2)), null);
    }

    private static String upper(String s) {
        return s == null ? "" : s.trim().toUpperCase(Locale.ROOT);
    }
}
