package com.cartera.service.market;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/** Peticiones HTTP a las fuentes de mercado: JSON o texto, con tiempo máximo y errores que dicen el código. */
@Component
@RequiredArgsConstructor
public class MarketHttp {

    /** Algunas fuentes solo atienden a navegadores (Yahoo niega la credencial a otros clientes). */
    public static final String BROWSER_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    public static final Duration TIMEOUT = Duration.ofSeconds(8);

    private final JsonMapper json;
    private final HttpClient shared = newClient(false);

    /** Cliente propio de una fuente; con cookies si la fuente las exige. */
    public static HttpClient newClient(boolean cookies) {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .connectTimeout(TIMEOUT)
                .followRedirects(HttpClient.Redirect.NORMAL);
        if (cookies) builder.cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL));
        return builder.build();
    }

    public static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    public JsonNode getJson(String url) {
        return getJson(shared, url, Map.of());
    }

    public JsonNode getJson(HttpClient client, String url, Map<String, String> headers) {
        return parse(url, send(client, request(url, headers).GET().build()));
    }

    public JsonNode postJson(String url, Object body, Map<String, String> headers) {
        HttpRequest.Builder r = request(url, headers).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        return parse(url, send(shared, r.build()));
    }

    public String getText(String url, Map<String, String> headers) {
        return getText(shared, url, headers);
    }

    public String getText(HttpClient client, String url, Map<String, String> headers) {
        return send(client, request(url, headers).GET().build()).body();
    }

    public JsonNode readTree(String text) {
        return json.readTree(text);
    }

    public JsonMapper mapper() {
        return json;
    }

    private static HttpRequest.Builder request(String url, Map<String, String> headers) {
        HttpRequest.Builder r = HttpRequest.newBuilder(URI.create(url)).timeout(TIMEOUT)
                .header("User-Agent", BROWSER_UA).header("Accept", "application/json, text/plain, */*");
        headers.forEach(r::setHeader);
        return r;
    }

    private static HttpResponse<String> send(HttpClient client, HttpRequest request) {
        String where = request.uri().getHost() + request.uri().getPath();
        HttpResponse<String> res;
        try {
            res = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (HttpTimeoutException e) {
            throw new MarketSourceException("timeout en " + where, e);
        } catch (IOException e) {
            throw new MarketSourceException("ECONN " + where + ": " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MarketSourceException("Consulta interrumpida a " + where, e);
        }
        if (res.statusCode() >= 400) {
            String body = res.body() == null ? "" : res.body().replaceAll("\\s+", " ").trim();
            throw new MarketSourceException("HTTP " + res.statusCode() + " en " + where
                    + (body.isEmpty() ? "" : ": " + body.substring(0, Math.min(160, body.length()))));
        }
        return res;
    }

    private JsonNode parse(String url, HttpResponse<String> res) {
        try {
            return json.readTree(res.body());
        } catch (JacksonException e) {
            throw new MarketSourceException("Respuesta no válida de " + URI.create(url).getHost(), e);
        }
    }
}
