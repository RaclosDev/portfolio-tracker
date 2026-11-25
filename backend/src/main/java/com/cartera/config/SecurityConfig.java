package com.cartera.config;

import jakarta.servlet.Filter;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.HeaderWriter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;

/**
 * Reglas de acceso y cabeceras de seguridad. El CSRF de Spring está desactivado: la API se autentica con la
 * cabecera Authorization, que el navegador no manda solo, y las rutas que usan la cookie del refresh token
 * ({@code /api/auth/}) las protegen SameSite=Strict y {@link CsrfOriginFilter}.
 */
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    /** El portfolio del autor: la única web ajena que puede enseñar la demo dentro de un marco. */
    static final String PORTFOLIO_ORIGIN = "https://portfolio.raclos.es";

    /**
     * Quién puede enmarcar cada página: la aplicación, solo su propio dominio; la demo (/demo, con
     * una cartera de ejemplo y sin sesión), también el portfolio. Va después de la cabecera de la CSP.
     */
    static final HeaderWriter FRAMING = (request, response) -> {
        String path = request.getRequestURI();
        if (path.equals("/demo") || path.startsWith("/demo/")) {
            response.setHeader("Content-Security-Policy", response.getHeader("Content-Security-Policy")
                    .replace("frame-ancestors 'self'", "frame-ancestors 'self' " + PORTFOLIO_ORIGIN));
        } else {
            response.setHeader("X-Frame-Options", "SAMEORIGIN");
        }
    };

    private final JwtAuthFilter jwtAuthFilter;
    private final RateLimitingFilter rateLimitingFilter;
    private final CsrfOriginFilter csrfOriginFilter;

    // Los filtros solo actúan dentro de la cadena de seguridad, no también como filtros sueltos del servlet.
    @Bean
    public FilterRegistrationBean<JwtAuthFilter> jwtAuthFilterRegistration(JwtAuthFilter filter) {
        return disabled(filter);
    }

    @Bean
    public FilterRegistrationBean<RateLimitingFilter> rateLimitingFilterRegistration(RateLimitingFilter filter) {
        return disabled(filter);
    }

    @Bean
    public FilterRegistrationBean<CsrfOriginFilter> csrfOriginFilterRegistration(CsrfOriginFilter filter) {
        return disabled(filter);
    }

    private static <T extends Filter> FilterRegistrationBean<T> disabled(T filter) {
        FilterRegistrationBean<T> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(ex -> ex.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.POST, "/api/auth/password/login", "/api/auth/password/register",
                        "/api/auth/google/login").permitAll()
                // Refresco y logout: se autentican con la cookie del refresh token.
                .requestMatchers(HttpMethod.POST, "/api/auth/session/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/auth/config", "/api/health", "/api/public/**").permitAll()
                .requestMatchers(HttpMethod.HEAD, "/api/health").permitAll()
                .requestMatchers("/actuator/health", "/actuator/health/**", "/actuator/info").permitAll()
                .requestMatchers("/api/**").authenticated()
                .requestMatchers("/actuator/**").denyAll()
                .requestMatchers("/**").permitAll()
            )
            .httpBasic(basic -> basic.disable())
            .formLogin(form -> form.disable())
            .logout(logout -> logout.disable())
            .headers(headers -> headers
                .frameOptions(frame -> frame.disable())
                .addHeaderWriter(FRAMING)
                .contentTypeOptions(content -> {})
                .referrerPolicy(ref -> ref.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
                .httpStrictTransportSecurity(hsts -> hsts.includeSubDomains(true).maxAgeInSeconds(31536000))
                .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'; "
                        // Botón «Iniciar sesión con Google» (Google Identity Services).
                        + "script-src 'self' https://accounts.google.com/gsi/client; "
                        + "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; "
                        + "font-src 'self'; "
                        + "img-src 'self' data: blob: https:; "
                        + "connect-src 'self' https://accounts.google.com/gsi/; "
                        // La portada incrusta la demo (/demo). Quién puede enmarcar la web lo decide FRAMING.
                        + "frame-src 'self' https://accounts.google.com/gsi/; "
                        + "worker-src 'self'; manifest-src 'self'; "
                        + "base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self'"))
                .permissionsPolicyHeader(perm -> perm.policy("camera=(), microphone=(), geolocation=()"))
            )
            .addFilterBefore(rateLimitingFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(csrfOriginFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
