package com.cartera.config;

import org.springframework.web.util.UrlPathHelper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletRequestWrapper;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Límite de intentos en las rutas de entrada ({@code /api/auth/password/**} y {@code /api/auth/google/**}), por
 * IP y en total: frena que se prueben contraseñas a ciegas. Ventana fija en memoria (una sola instancia).
 * <p>
 * La IP sale de X-Forwarded-For contando saltos desde la derecha ({@code app.rate-limiting.trusted-proxy-hops}):
 * el primer valor lo escribe el cliente y se puede inventar, el último lo añade el proxy de Render. Se lee de la
 * petición original porque {@code ForwardedHeaderFilter} ya ha sustituido la dirección por la primera de la lista.
 */
@Component
public class RateLimitingFilter extends OncePerRequestFilter {

    private static final String AUTH_PREFIX = "/api/auth/";
    private static final String GLOBAL = "*";
    private static final String LOGO_PREFIX = "/api/public/logo/";
    /** Logos por IP y minuto: una lista larga pide decenas a la vez, pero no cientos. */
    static final int MAX_LOGOS_PER_MINUTE = 240;

    private final boolean enabled;
    private final Cache<String, AtomicInteger> logins = window(Duration.ofMinutes(15));
    private final Cache<String, AtomicInteger> registrations = window(Duration.ofHours(1));
    private final Cache<String, AtomicInteger> burst = window(Duration.ofMinutes(1));
    private final Cache<String, AtomicInteger> logoRequests = window(Duration.ofMinutes(1));

    private final int trustedProxyHops;

    public RateLimitingFilter(@Value("${app.rate-limiting.enabled:true}") boolean enabled,
                              @Value("${app.rate-limiting.trusted-proxy-hops:1}") int trustedProxyHops) {
        this.enabled = enabled;
        this.trustedProxyHops = trustedProxyHops;
    }

    private static Cache<String, AtomicInteger> window(Duration length) {
        return Caffeine.newBuilder().expireAfterWrite(length).maximumSize(10_000).build();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = UrlPathHelper.defaultInstance.getPathWithinApplication(request);
        if (!enabled) return true;
        if ("GET".equalsIgnoreCase(request.getMethod())) return !path.startsWith(LOGO_PREFIX);
        return !"POST".equalsIgnoreCase(request.getMethod()) || !path.startsWith(AUTH_PREFIX)
                || path.startsWith("/api/auth/session/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String ip = clientIp(request);
        String path = UrlPathHelper.defaultInstance.getPathWithinApplication(request);
        // El total es solo un techo de seguridad: alto para que un único atacante no deje fuera a todos.
        boolean allowed;
        if (path.startsWith(LOGO_PREFIX)) {
            // Logos públicos (cada ISIN desconocido cuesta una búsqueda a una API externa): tope por IP.
            allowed = take(logoRequests, ip, MAX_LOGOS_PER_MINUTE);
        } else {
            allowed = take(burst, ip, 30) && take(burst, GLOBAL, 600);
            if (allowed && path.equals("/api/auth/password/login")) allowed = take(logins, ip, 10);
            if (allowed && path.equals("/api/auth/password/register")) allowed = take(registrations, ip, 5) && take(registrations, GLOBAL, 30);
        }
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

    /** La IP del visitante: el salto que añadió el último proxy de confianza (no el que manda el navegador). */
    public String clientIp(HttpServletRequest request) {
        ServletRequest original = request;
        while (original instanceof ServletRequestWrapper wrapper) original = wrapper.getRequest();
        HttpServletRequest raw = original instanceof HttpServletRequest http ? http : request;
        if (trustedProxyHops > 0) {
            List<String> hops = new ArrayList<>();
            Enumeration<String> headers = raw.getHeaders("X-Forwarded-For");
            while (headers != null && headers.hasMoreElements()) {
                for (String hop : headers.nextElement().split(",")) {
                    if (!hop.isBlank()) hops.add(hop.trim());
                }
            }
            if (!hops.isEmpty()) return hops.get(Math.max(0, hops.size() - trustedProxyHops));
        }
        return raw.getRemoteAddr();
    }

    private static boolean take(Cache<String, AtomicInteger> counters, String key, int max) {
        return counters.get(key, k -> new AtomicInteger()).incrementAndGet() <= max;
    }
}
