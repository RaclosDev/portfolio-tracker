package com.cartera.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

/** La IP del cliente es la que añade el proxy de confianza, no la que se inventa el cliente. */
class RateLimitingFilterTest {

    private final RateLimitingFilter filter = new RateLimitingFilter(true, 1);

    @Test
    void takesTheHopAddedByTheTrustedProxy() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.0.1");
        req.addHeader("X-Forwarded-For", "1.2.3.4, 203.0.113.7");
        assertThat(filter.clientIp(req)).isEqualTo("203.0.113.7");
    }

    @Test
    void spoofedHeadersOnSeveralLinesDoNotWin() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader("X-Forwarded-For", "1.2.3.4");
        req.addHeader("X-Forwarded-For", "203.0.113.7");
        assertThat(filter.clientIp(req)).isEqualTo("203.0.113.7");
    }

    @Test
    void logosAreLimitedPerIpAndNothingElseIsTouched() throws Exception {
        for (int i = 0; i < RateLimitingFilter.MAX_LOGOS_PER_MINUTE; i++) {
            assertThat(logo("198.51.100.1").getStatus()).isEqualTo(200);
        }
        assertThat(logo("198.51.100.1").getStatus()).isEqualTo(429);
        // Otra IP no se ve afectada.
        assertThat(logo("198.51.100.2").getStatus()).isEqualTo(200);
        // Y el resto de peticiones GET no pasan por el filtro.
        MockHttpServletRequest other = new MockHttpServletRequest("GET", "/api/health");
        assertThat(filter.shouldNotFilter(other)).isTrue();
    }

    private MockHttpServletResponse logo(String ip) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/public/logo/ES0113900J37");
        req.setRemoteAddr(ip);
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilter(req, res, new MockFilterChain());
        return res;
    }

    @Test
    void withoutProxyUsesTheSocketAddress() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("198.51.100.9");
        assertThat(filter.clientIp(req)).isEqualTo("198.51.100.9");
    }
}
