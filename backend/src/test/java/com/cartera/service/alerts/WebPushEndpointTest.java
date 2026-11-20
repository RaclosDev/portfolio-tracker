package com.cartera.service.alerts;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** Solo se envían avisos a los servicios de notificaciones de los navegadores (sin SSRF). */
class WebPushEndpointTest {

    @Test
    void acceptsBrowserPushServices() {
        assertThat(WebPushService.allowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).isTrue();
        assertThat(WebPushService.allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).isTrue();
        assertThat(WebPushService.allowedEndpoint("https://wns2-db5p.notify.windows.com/w/?token=abc")).isTrue();
        assertThat(WebPushService.allowedEndpoint("https://web.push.apple.com/abc")).isTrue();
    }

    @Test
    void rejectsEverythingElse() {
        assertThat(WebPushService.allowedEndpoint("https://169.254.169.254/latest/meta-data")).isFalse();
        assertThat(WebPushService.allowedEndpoint("http://fcm.googleapis.com/fcm/send/abc")).isFalse();
        assertThat(WebPushService.allowedEndpoint("https://fcm.googleapis.com:8443/abc")).isFalse();
        assertThat(WebPushService.allowedEndpoint("https://user@fcm.googleapis.com/abc")).isFalse();
        assertThat(WebPushService.allowedEndpoint("https://fcm.googleapis.com.evil.test/abc")).isFalse();
        assertThat(WebPushService.allowedEndpoint("https://evilpush.services.mozilla.com.test/abc")).isFalse();
        assertThat(WebPushService.allowedEndpoint("https://localhost/abc")).isFalse();
        assertThat(WebPushService.allowedEndpoint("no es una url")).isFalse();
    }
}
