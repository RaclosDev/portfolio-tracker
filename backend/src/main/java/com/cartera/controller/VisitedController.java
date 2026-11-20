package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.VisitedRequest;
import com.cartera.dto.VisitedResponse;
import com.cartera.dto.WatchlistView;
import com.cartera.service.VisitedService;
import com.cartera.service.watchlist.WatchlistViewService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Lista «Visitados»: lo abierto desde el buscador de la cabecera. */
@RestController
@RequestMapping("/api/visited")
@RequiredArgsConstructor
public class VisitedController {

    private final VisitedService visited;
    private final WatchlistViewService views;

    @GetMapping
    public List<VisitedResponse> list(@AuthenticationPrincipal CurrentUser user) {
        return visited.list(user.id());
    }

    /** La lista con precios y cálculos, como cualquier otra. */
    @GetMapping("/watchlist")
    public WatchlistView watchlist(@AuthenticationPrincipal CurrentUser user,
                                   @RequestParam(required = false) @Pattern(regexp = "1|true") String force,
                                   @RequestParam(required = false) @Pattern(regexp = "1|true") String live) {
        return views.visited(user.id(), force != null, live != null ? MarketController.LIVE_MAX_AGE_MS : null);
    }

    @PostMapping
    public List<VisitedResponse> visit(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody VisitedRequest req) {
        return visited.visit(user.id(), req);
    }

    @DeleteMapping("/{symbol}")
    public List<VisitedResponse> remove(@AuthenticationPrincipal CurrentUser user,
                                        @PathVariable @Size(min = 1, max = 32) String symbol) {
        return visited.remove(user.id(), symbol);
    }
}
