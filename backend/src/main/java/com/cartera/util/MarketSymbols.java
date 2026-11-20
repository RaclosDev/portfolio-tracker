package com.cartera.util;

import java.util.Locale;
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

    private static String upper(String s) {
        return s == null ? "" : s.trim().toUpperCase(Locale.ROOT);
    }
}
