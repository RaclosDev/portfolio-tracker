package com.cartera.config;

import com.cartera.repository.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import com.cartera.event.UserDeletedEvent;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.List;
import java.util.UUID;

/**
 * Autentica la petición con el access token de {@code Authorization: Bearer}. El id del usuario queda en el
 * MDC como {@code userId} para que cada línea de log diga de quién era la petición.
 */
@Component
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";
    private static final String MDC_USER_ID = "userId";

    private final JwtUtil jwtUtil;
    private final UserRepository users;

    /**
     * Usuarios ya comprobados, para no ir a la base de datos en cada petición (la vista de una lista lanza varias
     * a la vez y el pool es pequeño). El token ya está verificado; esto solo confirma que el usuario existe y da su
     * correo, que no cambia. Un usuario borrado deja de entrar en 30 s como mucho.
     */
    private final Cache<UUID, CurrentUser> known = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(30)).maximumSize(10_000).build();

    /** La cuenta se ha borrado: deja de entrar ya, sin esperar a que caduque la comprobación en memoria. */
    @TransactionalEventListener
    public void onUserDeleted(UserDeletedEvent event) {
        known.invalidate(event.userId());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            jwtUtil.verify(header.substring(BEARER_PREFIX.length()))
                    .map(id -> known.get(id, k -> users.findById(k)
                            .map(user -> new CurrentUser(user.getId(), user.getEmail())).orElse(null)))
                    .ifPresent(user -> {
                        var auth = new UsernamePasswordAuthenticationToken(user,
                                null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
                        SecurityContextHolder.getContext().setAuthentication(auth);
                        MDC.put(MDC_USER_ID, user.id().toString());
                    });
        }
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_USER_ID);
        }
    }
}
