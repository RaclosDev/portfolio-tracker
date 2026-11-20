package com.cartera.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Ajustes de la interfaz y de los avisos. Se guardan como JSON; lo que falta toma el valor de
 * {@link #DEFAULTS} y lo que no se conoce se descarta (ver {@code SettingsService}).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Settings(
        @NotNull @Pattern(regexp = "[A-Z]{3}", message = "debe ser un código de divisa de 3 letras") String baseCurrency,
        @NotNull @Positive Double defaultInvest,
        /** Límites (% que le falta caer) de cada tramo; por encima de {@code far}, «muy lejos». */
        @NotNull @Valid Bands bands,
        @NotNull Map<String, @NotBlank @Size(max = 24) String> statusNames,
        @NotNull Map<String, @NotBlank @Size(max = 16) String> tagNames,
        boolean blinkReached,
        @Min(15) @Max(3600) int refreshSeconds,
        @NotNull Map<String, @NotNull @Pattern(regexp = HEX, message = "debe ser un color #RRGGBB") String> colors,
        @NotNull @Pattern(regexp = "classic|paper") String skin,
        @NotNull @Pattern(regexp = "system|light|dark") String theme,
        /** Icono de la pestaña y de «Añadir a pantalla de inicio». */
        @NotNull @Pattern(regexp = "ink|paper|night") String appIcon,
        @NotNull @Pattern(regexp = "compact|normal|comfortable") String density,
        @NotNull @Pattern(regexp = "small|normal|large") String fontSize,
        @NotNull @Size(max = 30) List<@NotNull @Size(max = 30) String> hiddenColumns,
        @NotNull @Size(max = 30) List<@NotNull @Size(max = 30) String> extraColumns,
        @NotNull @Valid Notifications notifications) {

    private static final String HEX = "#[0-9a-fA-F]{6}";
    private static final String HHMM = "[0-9]{2}:[0-9]{2}";

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Bands(
            @DecimalMin("0") @DecimalMax("100") double veryNear,
            @DecimalMin("0") @DecimalMax("100") double near,
            @DecimalMin("0") @DecimalMax("100") double far) {
    }

    /** Avisos que manda el servidor a los dispositivos suscritos. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Notifications(
            boolean enabled,
            boolean reached,
            boolean near,
            boolean orders,
            /** No comprobar sábados y domingos. */
            boolean skipWeekends,
            /** Sin avisos entre quietFrom y quietTo (hora de España). */
            boolean quietHours,
            @NotNull @Pattern(regexp = HHMM) String quietFrom,
            @NotNull @Pattern(regexp = HHMM) String quietTo,
            boolean dailySummary,
            @NotNull @Pattern(regexp = HHMM) String dailySummaryAt) {
    }

    public static final Settings DEFAULTS = new Settings(
            "EUR", 2500d,
            new Bands(5, 10, 20),
            ordered("reached", "En zona", "veryNear", "Muy cerca", "near", "Cerca", "far", "Lejos", "veryFar", "Muy lejos"),
            ordered("equity", "ACC", "etf", "ETF", "muted", "Sin avisos"),
            true, 60,
            ordered("reached", "#00ff5e", "veryNear", "#00ff5e", "near", "#ffcb13", "far", "#ff0000",
                    "veryFar", "#000000", "equity", "#64748b", "etf", "#64748b", "base", "#64748b",
                    "fx", "#0284c7", "order", "#001eff", "expired", "#ff0000", "muted", "#a1a1aa",
                    "up", "#00ff1e", "down", "#ff0000", "broker", "#7c3aed", "consensus", "#2563eb"),
            "classic", "system", "ink", "normal", "normal",
            List.of(), List.of(),
            new Notifications(true, true, true, true, true, true, "22:00", "08:00", true, "09:15"));

    private static Map<String, String> ordered(String... keyValues) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) map.put(keyValues[i], keyValues[i + 1]);
        return java.util.Collections.unmodifiableMap(map);
    }
}
