package com.cartera.util;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

import static java.util.Map.entry;

/** Códigos ISIN y su traducción a tickers de Yahoo con los códigos de bolsa de OpenFIGI. */
public final class Isin {

    public static final Pattern PATTERN = Pattern.compile("^[A-Z]{2}[A-Z0-9]{9}\\d$");

    /** Código de bolsa de OpenFIGI → sufijo de Yahoo, en orden de preferencia. */
    public static final List<Map.Entry<String, String>> SUFFIX = List.of(
            entry("SM", ".MC"), entry("SQ", ".MC"), // España
            entry("NA", ".AS"), // Ámsterdam
            entry("FP", ".PA"), // París
            entry("GY", ".DE"), entry("GR", ".DE"), // Xetra / Alemania
            entry("IM", ".MI"), // Milán
            entry("LN", ".L"), // Londres
            entry("SW", ".SW"), entry("SE", ".SW"), // Suiza
            entry("BB", ".BR"), // Bruselas
            entry("PL", ".LS"), // Lisboa
            entry("ID", ".IR"), // Dublín
            entry("AV", ".VI"), // Viena
            entry("FH", ".HE"), // Helsinki
            entry("DC", ".CO"), // Copenhague
            entry("SS", ".ST"), // Estocolmo
            entry("NO", ".OL"), // Oslo
            entry("CN", ".TO"), entry("CT", ".TO"), // Toronto
            entry("AU", ".AX"), entry("AT", ".AX"), // Australia
            entry("JP", ".T"), entry("JT", ".T"), // Tokio
            entry("HK", ".HK"), // Hong Kong
            entry("US", ""), entry("UN", ""), entry("UQ", ""), entry("UW", ""), entry("UA", ""), entry("UR", "")); // EE. UU.

    /** Bolsas preferidas según el país del ISIN (las «de casa» del valor). */
    public static final Map<String, List<String>> HOME = Map.ofEntries(
            entry("ES", List.of("SM")), entry("NL", List.of("NA")), entry("FR", List.of("FP")),
            entry("DE", List.of("GY", "GR")), entry("IT", List.of("IM")), entry("GB", List.of("LN")),
            entry("CH", List.of("SW", "SE")), entry("BE", List.of("BB")), entry("PT", List.of("PL")),
            entry("IE", List.of("LN", "GY", "NA", "IM")), entry("LU", List.of("GY", "LN", "NA", "IM")),
            entry("AT", List.of("AV")), entry("FI", List.of("FH")), entry("DK", List.of("DC")),
            entry("SE", List.of("SS")), entry("NO", List.of("NO")), entry("CA", List.of("CN")),
            entry("AU", List.of("AU")), entry("JP", List.of("JP")), entry("HK", List.of("HK")),
            entry("US", List.of("US", "UN", "UQ", "UW")),
            // Sin sufijo de Yahoo, pero dan el ticker de casa de una posición de un fondo (TSMC → 2330).
            entry("TW", List.of("TT")), entry("KR", List.of("KS")), entry("CN", List.of("CH", "C1", "C2")),
            entry("IN", List.of("IN", "IB")), entry("BR", List.of("BZ")));

    private Isin() {
    }

    public static boolean isIsin(String q) {
        return q != null && PATTERN.matcher(q.trim().toUpperCase(Locale.ROOT)).matches();
    }

    /** Sufijo de Yahoo de un código de bolsa, o null si Yahoo no la tiene. */
    public static String suffix(String exchCode) {
        for (Map.Entry<String, String> e : SUFFIX) if (e.getKey().equals(exchCode)) return e.getValue();
        return null;
    }

    public static int suffixRank(String exchCode) {
        for (int i = 0; i < SUFFIX.size(); i++) if (SUFFIX.get(i).getKey().equals(exchCode)) return i;
        return SUFFIX.size();
    }

    public static List<String> home(String isin) {
        return HOME.getOrDefault(isin.substring(0, 2).toUpperCase(Locale.ROOT), List.of());
    }

    public static String toYahoo(String ticker, String exchCode) {
        return ticker.replaceAll("[/ ]", "-") + suffix(exchCode);
    }
}
