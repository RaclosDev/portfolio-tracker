package com.cartera.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

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
    void withoutProxyUsesTheSocketAddress() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("198.51.100.9");
        assertThat(filter.clientIp(req)).isEqualTo("198.51.100.9");
    }
}
