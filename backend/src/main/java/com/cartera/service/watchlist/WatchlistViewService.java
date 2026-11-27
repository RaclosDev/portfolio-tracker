package com.cartera.service.watchlist;

import com.cartera.dto.ItemResponse;
import com.cartera.dto.ListResponse;
import com.cartera.dto.Settings;
import com.cartera.dto.VisitedResponse;
import com.cartera.dto.WatchlistView;
import com.cartera.dto.market.AnalystTargets;
import com.cartera.dto.market.Quote;
import com.cartera.model.WatchList;
import com.cartera.repository.WatchItemRepository;
import com.cartera.service.SettingsService;
import com.cartera.service.VisitedService;
import com.cartera.service.market.MarketService;
import com.cartera.service.market.YahooProvider;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Monta una lista en pantalla: cotizaciones, consenso de analistas, tipos de cambio y cálculos de cada fila. */
@Service
@RequiredArgsConstructor
public class WatchlistViewService {

    public static final long VISITED_LIST_ID = -1;
    public static final String VISITED_LIST_NAME = "Visitados";
    private static final ZoneId MADRID = ZoneId.of("Europe/Madrid");

    private final WatchListService lists;
    private final WatchItemRepository items;
    private final VisitedService visited;
    private final SettingsService settings;
    private final MarketService market;
    private final TransactionTemplate tx;
    /**
     * ISIN ya guardados en la base de datos (valor@ISIN). El vigilante trabaja con los valores en memoria, que siguen
     * sin ISIN hasta la recarga: sin esta marca escribiría lo mismo cada 10 s y la base de datos no podría dormirse.
     */
    private final Set<String> isinsSaved = java.util.Collections.newSetFromMap(
            Caffeine.newBuilder().maximumSize(20_000).<String, Boolean>build().asMap());

    /**
     * {@code maxAgeMs}: antigüedad máxima de los precios (más corta con la lista en pantalla), o null para la normal.
     * Sin transacción: las llamadas a mercado tardan y no deben retener una conexión del pool mientras tanto.
     */
    public WatchlistView view(UUID userId, Long listId, boolean force, Long maxAgeMs) {
        WatchList list = lists.owned(userId, listId);
        List<ItemResponse> rows = items.findByListIdOrderByPositionAscIdAsc(listId).stream().map(ItemResponse::of).toList();
        return build(userId, new ListResponse(list.getId(), list.getName(), rows.size()), rows, force, maxAgeMs);
    }

    /** La lista «Visitados»: filas sin precios de compra montadas con lo abierto desde el buscador. */
    public WatchlistView visited(UUID userId, boolean force, Long maxAgeMs) {
        List<VisitedResponse> entries = visited.list(userId);
        List<ItemResponse> rows = new ArrayList<>();
        for (int i = 0; i < entries.size(); i++) {
            VisitedResponse e = entries.get(i);
            Instant at = Instant.parse(e.visitedAt());
            String name = e.name() == null || e.name().isEmpty() ? null : e.name();
            rows.add(new ItemResponse((long) -(i + 1), VISITED_LIST_ID, e.symbol(), null, e.isin(), name, List.of(),
                    null, null, null, null, false, null, null, null, null, at, at));
        }
        return build(userId, new ListResponse(VISITED_LIST_ID, VISITED_LIST_NAME, rows.size()), rows, force, maxAgeMs);
    }

    private WatchlistView build(UUID userId, ListResponse list, List<ItemResponse> rows, boolean force, Long maxAgeMs) {
        return build(list, rows, settings.get(userId), force, maxAgeMs);
    }

    /**
     * Monta la vista con datos que ya se tienen (el vigilante de avisos los guarda en memoria): no lee nada de la
     * base de datos, solo pide precios, consenso y cambios a la caché de mercado.
     */
    public WatchlistView build(ListResponse list, List<ItemResponse> rows, Settings s, boolean force, Long maxAgeMs) {
        List<String> symbols = rows.stream().map(ItemResponse::symbol).toList();

        Map<String, Quote> quotes = market.getQuotes(symbols, force, maxAgeMs != null ? maxAgeMs : market.quoteTtlMs());
        List<String> equities = symbols.stream().filter(sym -> {
            Quote q = quotes.get(sym);
            return !MarketService.NO_ANALYST_COVERAGE.contains(q == null || q.quoteType() == null ? "" : q.quoteType());
        }).toList();
        // El consenso cambia poco: no se fuerza su refresco (caché de horas).
        Map<String, AnalystTargets> targets = market.getTargets(equities, false);
        Set<String> fxStale = new LinkedHashSet<>();
        List<String> currencies = quotes.values().stream().map(Quote::currency).filter(Objects::nonNull).distinct().toList();
        Map<String, Double> fx = market.getFxRates(s.baseCurrency(), currencies, null, fxStale);

        LocalDate today = LocalDate.now(MADRID);
        List<WatchlistView.Row> out = new ArrayList<>();
        for (ItemResponse item : rows) {
            Quote quote = quotes.get(item.symbol());
            AnalystTargets t = targets.get(item.symbol());
            Double fxRate = quote != null && quote.currency() != null ? fx.get(quote.currency()) : null;
            ItemResponse shown = item.name() != null || quote == null ? item : item.withName(quote.name());
            // Sin ISIN guardado, el de la cotización se queda en el valor: así el logo no depende de qué fuente
            // conteste la próxima vez (Yahoo no lo trae).
            if (item.isin() == null && quote != null && quote.isin() != null) {
                String saved = item.id() + "@" + quote.isin();
                if (item.id() > 0 && !isinsSaved.contains(saved)) {
                    tx.executeWithoutResult(st -> items.fillIsin(item.id(), item.symbol(), quote.isin()));
                    isinsSaved.add(saved);
                }
                shown = shown.withIsin(quote.isin());
            }
            out.add(new WatchlistView.Row(shown, quote, t, Metrics.compute(item, quote, t, fxRate, s, today)));
        }
        return new WatchlistView(list, s, out, fx, List.copyOf(fxStale),
                YahooProvider.ISO_MS.format(Instant.now()), market.throttledUntilIso());
    }
}
