package com.cartera.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Texto y números de las fichas HTML de las fuentes de fondos. */
public final class Html {

    private static final Pattern TAG = Pattern.compile("<[^>]*>");
    private static final Pattern NUMERIC_ENTITY = Pattern.compile("&#(\\d+);");
    private static final Pattern EUROPEAN_DECIMAL = Pattern.compile("^[+-]?\\d+(?:\\.\\d{3})*(?:,\\d+)?$");

    private Html() {
    }

    /** Texto visible de un trozo de HTML: sin etiquetas, con las entidades resueltas y los espacios juntos. */
    public static String text(String html) {
        if (html == null) return "";
        String s = TAG.matcher(html).replaceAll(" ")
                .replace("&nbsp;", " ").replace("&#160;", " ")
                .replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'");
        Matcher m = NUMERIC_ENTITY.matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            int code;
            try {
                code = Integer.parseInt(m.group(1));
            } catch (NumberFormatException e) {
                code = -1;
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(code >= 0 && code <= 0xFFFF ? String.valueOf((char) code) : m.group()));
        }
        m.appendTail(sb);
        return sb.toString().replace("&amp;", "&").replaceAll("\\s+", " ").trim();
    }

    /** Número con formato europeo (1.234,56); NaN si no lo es. */
    public static double decimal(String value) {
        if (value == null || !EUROPEAN_DECIMAL.matcher(value).matches()) return Double.NaN;
        return Double.parseDouble(value.replace(".", "").replace(',', '.'));
    }
}
