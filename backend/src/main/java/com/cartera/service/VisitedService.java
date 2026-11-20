package com.cartera.service;

import com.cartera.dto.VisitedRequest;
import com.cartera.dto.VisitedResponse;
import com.cartera.model.VisitedSymbol;
import com.cartera.repository.VisitedSymbolRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** «Visitados»: lo abierto desde el buscador de la cabecera, el último primero. De momento no caduca. */
@Service
@RequiredArgsConstructor
public class VisitedService {

    static final int MAX = 200;

    private final VisitedSymbolRepository repository;

    @Transactional(readOnly = true)
    public List<VisitedResponse> list(UUID userId) {
        return repository.findByUserIdOrderByVisitedAtDesc(userId).stream().map(VisitedResponse::of).toList();
    }

    /** Lo pone el primero (si ya estaba, conserva el ISIN que se supiera) y devuelve la lista. */
    @Transactional
    public List<VisitedResponse> visit(UUID userId, VisitedRequest req) {
        String symbol = req.symbol().trim().toUpperCase(Locale.ROOT);
        VisitedSymbol row = repository.findById(new VisitedSymbol.Key(userId, symbol)).orElseGet(() -> {
            VisitedSymbol v = new VisitedSymbol();
            v.setUserId(userId);
            v.setSymbol(symbol);
            return v;
        });
        row.setName(fit(req.name(), 200, ""));
        row.setExchange(fit(req.exchange(), 80, null));
        row.setType(fit(req.type(), 40, null));
        if (req.isin() != null) row.setIsin(req.isin());
        row.setVisitedAt(Instant.now());
        repository.saveAndFlush(row);
        List<VisitedSymbol> all = repository.findByUserIdOrderByVisitedAtDesc(userId);
        if (all.size() > MAX) repository.deleteAll(all.subList(MAX, all.size()));
        return all.stream().limit(MAX).map(VisitedResponse::of).toList();
    }

    @Transactional
    public List<VisitedResponse> remove(UUID userId, String symbol) {
        repository.deleteById(new VisitedSymbol.Key(userId, symbol.trim().toUpperCase(Locale.ROOT)));
        repository.flush();
        return list(userId);
    }

    private static String fit(String value, int max, String fallback) {
        return value == null || value.length() > max ? fallback : value;
    }
}
