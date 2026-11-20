package com.cartera.config;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Límite de intentos en las rutas de entrada ({@code /api/auth/password/**} y {@code /api/auth/google/**}), por
 * IP y en total: frena que se prueben contraseñas a ciegas. Ventana fija en memoria (una sola instancia).
 * La IP es la del cliente: {@code server.forward-headers-strategy=framework} aplica X-Forwarded-For del proxy.
 */
@Component
public class RateLimitingFilter extends OncePerRequestFilter {

    private static final String AUTH_PREFIX = "/api/auth/";
    private static final String GLOBAL = "*";

    private final boolean enabled;
    private final Cache<String, AtomicInteger> logins = window(Duration.ofMinutes(15));
    private final Cache<String, AtomicInteger> registrations = window(Duration.ofHours(1));
    private final Cache<String, AtomicInteger> burst = window(Duration.ofMinutes(1));

    public RateLimitingFilter(@Value("${app.rate-limiting.enabled:true}") boolean enabled) {
        this.enabled = enabled;
    }

    private static Cache<String, AtomicInteger> window(Duration length) {
        return Caffeine.newBuilder().expireAfterWrite(length).maximumSize(10_000).build();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !enabled || !"POST".equalsIgnoreCase(request.getMethod()) || !path.startsWith(AUTH_PREFIX)
                || path.startsWith("/api/auth/session/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String ip = request.getRemoteAddr();
        String path = request.getRequestURI();
        boolean allowed = take(burst, ip, 30) && take(burst, GLOBAL, 120);
        if (allowed && path.equals("/api/auth/password/login")) allowed = take(logins, ip, 10);
        if (allowed && path.equals("/api/auth/password/register")) allowed = take(registrations, ip, 5) && take(registrations, GLOBAL, 30);
        if (allowed) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader("Retry-After", "60");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"error\": \"Demasiados intentos. Espera unos minutos y vuelve a probar.\"}");
    }

    private static boolean take(Cache<String, AtomicInteger> counters, String key, int max) {
        return counters.get(key, k -> new AtomicInteger()).incrementAndGet() <= max;
    }
}
