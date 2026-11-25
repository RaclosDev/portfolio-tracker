package com.cartera.service.market;

import com.cartera.service.market.PublicMarketService.Snapshot;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

/**
 * Las respuestas de la demo ya convertidas a JSON y comprimidas. La completa pesa 2 MB (cinco años de velas de 24
 * valores): con 0,1 CPU, convertirla en cada visita costaba ~800 ms y retrasaba también la de las cotizaciones, que
 * es la que espera la primera pantalla. Se rehace solo cuando cambia la copia de {@link PublicMarketService}.
 */
@Component
@RequiredArgsConstructor
public class DemoPayload {

    /** El JSON tal cual y en gzip, del snapshot del que sale. */
    public record Encoded(byte[] json, byte[] gzip, Snapshot source) {}

    private final PublicMarketService market;
    private final JsonMapper mapper;
    private volatile Encoded full;
    private volatile Encoded quotes;

    /** Cotizaciones y velas de cinco años. */
    public Encoded full() {
        Snapshot s = market.demo();
        Encoded e = full;
        if (e == null || e.source() != s) full = e = encode(s, s);
        return e;
    }

    /** Solo las cotizaciones: lo que necesita la primera pantalla. */
    public Encoded quotes() {
        Snapshot s = market.demo();
        Encoded e = quotes;
        if (e == null || e.source() != s) quotes = e = encode(new Snapshot(s.quotes(), Map.of(), s.fetchedAt()), s);
        return e;
    }

    private Encoded encode(Snapshot body, Snapshot source) {
        byte[] json = mapper.writeValueAsBytes(body);
        ByteArrayOutputStream out = new ByteArrayOutputStream(json.length / 4);
        try (GZIPOutputStream gz = new GZIPOutputStream(out)) {
            gz.write(json);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return new Encoded(json, out.toByteArray(), source);
    }
}
