package com.cartera.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Tope de tamaño para los cuerpos que no son multipart (JSON de restaurar, importar o dibujos). Tomcat solo limita
 * los formularios y los límites de multipart no se aplican aquí, así que un cuerpo enorme se leería entero en memoria.
 * Con {@code Content-Length} se rechaza antes de leer; sin él (chunked), al pasar del tope durante la lectura.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class BodySizeLimitFilter extends OncePerRequestFilter {

    /** Igual que {@code spring.servlet.multipart.max-request-size}: una copia completa ocupa mucho menos. */
    static final long MAX_BYTES = 12L * 1024 * 1024;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String type = request.getContentType();
        return type != null && type.toLowerCase().startsWith("multipart/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > MAX_BYTES) {
            response.setStatus(HttpStatus.CONTENT_TOO_LARGE.value());
            response.setCharacterEncoding("UTF-8");
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\": \"La petición es demasiado grande.\"}");
            return;
        }
        chain.doFilter(new HttpServletRequestWrapper(request) {
            private ServletInputStream limited;

            @Override
            public ServletInputStream getInputStream() throws IOException {
                if (limited == null) limited = new Limited(super.getInputStream());
                return limited;
            }
        }, response);
    }

    /** Corta la lectura al pasar del tope. */
    private static final class Limited extends ServletInputStream {
        private final ServletInputStream in;
        private long read;

        Limited(ServletInputStream in) {
            this.in = in;
        }

        private int count(int n) throws IOException {
            if (n > 0 && (read += n) > MAX_BYTES) throw new IOException("La petición es demasiado grande.");
            return n;
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b >= 0) count(1);
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            return count(in.read(buf, off, len));
        }

        @Override
        public boolean isFinished() {
            return in.isFinished();
        }

        @Override
        public boolean isReady() {
            return in.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            in.setReadListener(listener);
        }
    }
}
