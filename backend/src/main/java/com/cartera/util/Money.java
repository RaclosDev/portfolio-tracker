package com.cartera.util;

import java.math.BigDecimal;
import java.math.MathContext;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/** Redondeos de importes y números con el formato de pantalla. */
public final class Money {

    private static final MathContext FIFTEEN = new MathContext(15);
    private static final Locale ES = Locale.forLanguageTag("es-ES");

    private Money() {
    }

    /**
     * Redondea a céntimos (la mitad, hacia fuera del cero). Pasa por 15 cifras significativas para que el error de
     * coma flotante no cambie el resultado: 1332,555 da 1332,56 aunque 1332,555 · 100 sea 133255,49999999999.
     */
    public static double cents(double x) {
        if (!Double.isFinite(x)) return x;
        double scaled = Math.abs(new BigDecimal(x * 100).round(FIFTEEN).doubleValue());
        double v = Math.floor(scaled + 0.5) / 100;
        return x < 0 && v != 0 ? -v : v;
    }

    /** Número en español con hasta cuatro decimales (1234,5; 12.345). Como el navegador: sin punto hasta 10.000. */
    public static String format(double n) {
        DecimalFormat f = new DecimalFormat("#,##0.####", DecimalFormatSymbols.getInstance(ES));
        f.setGroupingUsed(Math.abs(n) >= 10_000);
        return f.format(n);
    }
}
