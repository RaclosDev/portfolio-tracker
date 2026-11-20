package com.cartera.config;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Neon y Render dan la base de datos como {@code postgresql://usuario:clave@host/bd?sslmode=require}. Si DATABASE_URL
 * viene así, se traduce a la URL JDBC con su usuario y contraseña; una URL {@code jdbc:} se deja como está.
 */
public class DatabaseUrlEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication app) {
        Map<String, Object> props = toDatasource(env.getProperty("DATABASE_URL"));
        if (!props.isEmpty()) env.getPropertySources().addFirst(new MapPropertySource("databaseUrl", props));
    }

    static Map<String, Object> toDatasource(String url) {
        Map<String, Object> props = new HashMap<>();
        if (url == null || !(url.startsWith("postgres://") || url.startsWith("postgresql://"))) return props;
        URI uri = URI.create(url);
        String port = uri.getPort() > 0 ? ":" + uri.getPort() : "";
        String query = uri.getRawQuery() != null ? "?" + uri.getRawQuery() : "";
        props.put("spring.datasource.url", "jdbc:postgresql://" + uri.getHost() + port + uri.getRawPath() + query);
        String info = uri.getRawUserInfo();
        if (info != null) {
            int colon = info.indexOf(':');
            props.put("spring.datasource.username", decode(colon < 0 ? info : info.substring(0, colon)));
            if (colon >= 0) props.put("spring.datasource.password", decode(info.substring(colon + 1)));
        }
        return props;
    }

    private static String decode(String s) {
        return URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }
}
