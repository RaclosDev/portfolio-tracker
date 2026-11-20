package com.cartera.service.market;

import java.util.regex.Pattern;

/**
 * Fallo de una fuente de mercado. El mensaje lleva el código HTTP («HTTP 429», «HTTP 503»…) o «timeout» para que
 * quien lo recibe decida si pausar la fuente; nunca lleva la consulta de la URL (va con los símbolos pedidos).
 */
public class MarketSourceException extends RuntimeException {

    private static final Pattern RATE_LIMIT = Pattern.compile("\\b429\\b|too many requests", Pattern.CASE_INSENSITIVE);
    private static final Pattern OUTAGE =
            Pattern.compile("\\b5\\d\\d\\b|timeout|timed out|fetch failed|ECONN", Pattern.CASE_INSENSITIVE);

    public MarketSourceException(String message) {
        super(message);
    }

    public MarketSourceException(String message, Throwable cause) {
        super(message, cause);
    }

    /** ¿La fuente nos está limitando? */
    public static boolean isRateLimit(Throwable error) {
        return RATE_LIMIT.matcher(text(error)).find();
    }

    /** ¿Fallo de la fuente (y no de un símbolo concreto)? Esos pausan la fuente un rato. */
    public static boolean isOutage(Throwable error) {
        return OUTAGE.matcher(text(error)).find();
    }

    /** Texto corto de un error para el diagnóstico público: sin la consulta de las URL. */
    public static String summary(Throwable error) {
        String s = String.valueOf(error.getMessage()).replaceAll("\\?[^\\s\"')]*", "");
        return s.length() > 200 ? s.substring(0, 200) : s;
    }

    /** Mensaje del error y de sus causas. */
    public static String text(Throwable error) {
        StringBuilder sb = new StringBuilder();
        for (Throwable t = error; t != null && sb.length() < 2000; t = t.getCause()) {
            sb.append(t.getClass().getSimpleName()).append(": ").append(t.getMessage()).append(' ');
        }
        return sb.toString();
    }
}
