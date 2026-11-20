package com.cartera.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;
import java.time.Duration;
import java.util.regex.Pattern;

/**
 * La web compilada (frontend/dist, copiada a static/ en el Dockerfile). Los ficheros con hash de assets/ no cambian
 * nunca; index.html y el service worker se revalidan siempre. Las rutas de la SPA (/demo…) devuelven index.html;
 * la API y los ficheros que no existen dan un 404 de verdad.
 */
@Configuration
public class SpaWebConfig implements WebMvcConfigurer {

    private static final String STATIC = "classpath:/static/";
    /** Lo que parece un fichero de la web y no está da 404; lo demás (/demo, /valor/SAN.MC) es una ruta de la SPA. */
    private static final Pattern WEB_FILE = Pattern.compile(
            ".*\\.(?i:html?|js|mjs|css|map|json|webmanifest|txt|xml|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf)$");

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/assets/**")
                .addResourceLocations(STATIC + "assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
        registry.addResourceHandler("/**")
                .addResourceLocations(STATIC)
                .setCacheControl(CacheControl.noCache())
                // Los ficheros del jar tienen todos la fecha de 1980: con Last-Modified, el navegador recibía un 304
                // tras cada despliegue y se quedaba con el index.html (y el front) anterior.
                .setUseLastModified(false)
                .resourceChain(true)
                .addResolver(new SpaResolver());
    }

    static final class SpaResolver extends PathResourceResolver {
        @Override
        protected Resource getResource(String path, Resource location) throws IOException {
            Resource found = super.getResource(path, location);
            if (found != null) return found;
            if (path.startsWith("api/") || path.equals("api") || WEB_FILE.matcher(path).matches()) return null;
            return super.getResource("index.html", location);
        }
    }
}
