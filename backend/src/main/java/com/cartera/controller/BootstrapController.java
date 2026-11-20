package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.ListResponse;
import com.cartera.dto.Settings;
import com.cartera.dto.VisitedResponse;
import com.cartera.dto.WatchlistView;
import com.cartera.dto.alerts.AlertDtos.TouchedOrderResponse;
import com.cartera.dto.portfolio.PortfolioDtos.CarteraView;
import com.cartera.service.SettingsService;
import com.cartera.service.VisitedService;
import com.cartera.service.alerts.AlertService;
import com.cartera.service.portfolio.PortfolioService;
import com.cartera.service.watchlist.WatchListService;
import com.cartera.service.watchlist.WatchlistViewService;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import jakarta.validation.constraints.Pattern;

/**
 * Todo lo que pinta la primera pantalla en una sola petición: ajustes, listas, visitados, órdenes tocadas, la lista
 * abierta y la cartera. Antes eran nueve peticiones a la vez que, con 0,1 CPU, el servidor atendía en fila, y la
 * cartera llegaba después que la lista (la tabla se movía al rellenarse).
 */
@RestController
@RequestMapping("/api/bootstrap")
@RequiredArgsConstructor
public class BootstrapController {

    /** El id de «Visitados» en el front ({@code VISITED_LIST_ID}). */
    static final long VISITED_LIST_ID = -1;

    private final SettingsService settings;
    private final WatchListService lists;
    private final VisitedService visited;
    private final AlertService alerts;
    private final WatchlistViewService views;
    private final PortfolioService portfolio;

    public record Bootstrap(Settings settings, List<ListResponse> lists, List<VisitedResponse> visited,
                            List<TouchedOrderResponse> touchedOrders, Long listId, WatchlistView watchlist,
                            CarteraView portfolio) {
    }

    /**
     * {@code list}: la lista que el navegador tenía abierta (si ya no existe, la primera). {@code page}: la pantalla
     * visible, que pide precios casi en directo como lo haría su propia petición.
     */
    @GetMapping
    public Bootstrap get(@AuthenticationPrincipal CurrentUser user,
                         @RequestParam(required = false) Long list,
                         @RequestParam(required = false) @Pattern(regexp = "lista|cartera") String page) {
        UUID id = user.id();
        boolean onPortfolio = "cartera".equals(page);
        Long live = MarketController.LIVE_MAX_AGE_MS;
        // La cartera en paralelo: si hay que pedir cotizaciones, las dos esperas a la fuente se solapan.
        CompletableFuture<CarteraView> pf = CompletableFuture.supplyAsync(
                () -> portfolio.view(id, false, onPortfolio ? live : portfolio.defaultMaxAgeMs()),
                Thread::startVirtualThread);

        List<ListResponse> all = lists.all(id);
        Long listId = list != null && list == VISITED_LIST_ID ? Long.valueOf(VISITED_LIST_ID)
                : all.stream().map(ListResponse::id).filter(l -> l.equals(list)).findFirst()
                        .orElse(all.isEmpty() ? null : all.getFirst().id());
        Long maxAge = onPortfolio ? null : live;
        WatchlistView wl = listId == null ? null
                : listId == VISITED_LIST_ID ? views.visited(id, false, maxAge) : views.view(id, listId, false, maxAge);

        try {
            return new Bootstrap(settings.get(id), all, visited.list(id), alerts.touchedOrders(id), listId, wl, pf.join());
        } catch (CompletionException e) {
            if (e.getCause() instanceof RuntimeException r) throw r;
            throw e;
        }
    }
}
