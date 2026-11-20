package com.cartera.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.Map;

/** Un dibujo del gráfico de velas: soporte, tendencia, canal, texto… */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ChartDrawing(
        @NotBlank @Size(max = 40) String id,
        @NotNull @Pattern(regexp = "hline|hray|vline|text|trend|ray|extended|fib|rect|arrow|channel|long|short") String type,
        @NotNull @Size(min = 1, max = 3) List<@Valid @NotNull Point> points,
        @Pattern(regexp = "#[0-9a-fA-F]{6}") String color,
        @Min(1) @Max(4) Integer width,
        @Pattern(regexp = "solid|dashed|dotted") String style,
        Boolean locked,
        @Size(max = 200) String text) {

    /** Puntos que lleva cada tipo de dibujo. */
    public static final Map<String, Integer> POINTS = Map.ofEntries(
            Map.entry("hline", 1), Map.entry("hray", 1), Map.entry("vline", 1), Map.entry("text", 1),
            Map.entry("trend", 2), Map.entry("ray", 2), Map.entry("extended", 2), Map.entry("fib", 2),
            Map.entry("rect", 2), Map.entry("arrow", 2),
            Map.entry("channel", 3), Map.entry("long", 3), Map.entry("short", 3));

    /** Fecha de sesión, o fecha y hora UTC (YYYY-MM-DDTHH:MMZ) si se dibujó en un intervalo intradía. */
    public record Point(@NotNull @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}Z)?") String t,
                        @NotNull Double p) {
        @AssertTrue(message = "el precio no es un número")
        boolean isFinitePrice() {
            return p == null || Double.isFinite(p);
        }
    }

    @AssertTrue(message = "Número de puntos incorrecto para el dibujo")
    boolean isPointCountRight() {
        return type == null || points == null || !POINTS.containsKey(type) || points.size() == POINTS.get(type);
    }
}
