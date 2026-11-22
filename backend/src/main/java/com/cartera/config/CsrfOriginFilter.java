package com.cartera.config;

import org.springframework.web.util.UrlPathHelper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;

/**
 * Protección CSRF de {@code /api/auth/}, las únicas rutas que usan (o crean) la cookie del refresh token.
 * SameSite=Strict ya impide que la cookie salga desde otros sitios; además se exige que la petición venga de la
 * propia aplicación: {@code Origin} del mismo origen o de {@code app.cors.allowed-origins}, o, sin {@code Origin},
 * {@code Sec-Fetch-Site: same-origin}. El resto de la API usa la cabecera Authorization, que el navegador no
 * añade solo.
 */
@Component
@Slf4j
public class CsrfOriginFilter extends OncePerRequestFilter {

    private static final String PROTECTED_PREFIX = "/api/auth/";

    private final CorsConfiguration allowedOrigins = new CorsConfiguration();

    public CsrfOriginFilter(@Value("${app.cors.allowed-origins:}") String origins) {
        allowedOrigins.setAllowedOriginPatterns(Arrays.stream(origins.split(","))
                .map(String::trim).filter(o -> !o.isEmpty()).toList());
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equalsIgnoreCase(request.getMethod()) || !UrlPathHelper.defaultInstance.getPathWithinApplication(request).startsWith(PROTECTED_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String origin = request.getHeader(HttpHeaders.ORIGIN);
        boolean fromApp = origin == null
                ? "same-origin".equals(request.getHeader("Sec-Fetch-Site"))
                : !CorsUtils.isCorsRequest(request) || allowedOrigins.checkOrigin(origin) != null;
        if (fromApp) {
            chain.doFilter(request, response);
            return;
        }
        log.warn("Petición a {} rechazada por su origen: Origin={}", request.getRequestURI(), origin);
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"error\": \"Origen de la petición no permitido.\"}");
    }
}
