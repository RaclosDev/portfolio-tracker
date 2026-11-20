package com.cartera.config;

import com.cartera.event.UserDataChangedEvent;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Set;

/**
 * Publica {@link UserDataChangedEvent} al terminar cada petición de la API que puede cambiar datos (todo lo que no
 * es GET). Se hace aquí, en un solo sitio, para que ningún cambio nuevo se quede sin avisar: la transacción del
 * servicio ya ha terminado, así que quien recargue verá lo guardado. Avisar de más no cuesta nada (una lectura en
 * la siguiente vuelta); avisar de menos dejaría al vigilante de avisos con datos viejos.
 */
@Configuration
@RequiredArgsConstructor
public class UserDataChangedInterceptor implements HandlerInterceptor, WebMvcConfigurer {

    private static final Set<String> READ_ONLY = Set.of("GET", "HEAD", "OPTIONS");

    private final ApplicationEventPublisher events;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns("/api/**");
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        if (READ_ONLY.contains(request.getMethod())) return;
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof CurrentUser user) {
            events.publishEvent(new UserDataChangedEvent(user.id()));
        }
    }
}
