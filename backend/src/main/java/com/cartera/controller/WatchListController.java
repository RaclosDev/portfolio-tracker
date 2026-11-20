package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.ImportRequest;
import com.cartera.dto.ImportResponse;
import com.cartera.dto.ListRequest;
import com.cartera.dto.ListResponse;
import com.cartera.dto.WatchlistView;
import com.cartera.service.watchlist.WatchItemService;
import com.cartera.service.watchlist.WatchListService;
import com.cartera.service.watchlist.WatchlistViewService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/lists")
@RequiredArgsConstructor
public class WatchListController {

    private final WatchListService lists;
    private final WatchItemService items;
    private final WatchlistViewService views;

    @GetMapping
    public List<ListResponse> all(@AuthenticationPrincipal CurrentUser user) {
        return lists.all(user.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ListResponse create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody ListRequest request) {
        return lists.create(user.id(), request.name());
    }

    @PatchMapping("/{id}")
    public ListResponse rename(@AuthenticationPrincipal CurrentUser user, @PathVariable Long id,
                               @Valid @RequestBody ListRequest request) {
        return lists.rename(user.id(), id, request.name());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal CurrentUser user, @PathVariable Long id) {
        lists.delete(user.id(), id);
    }

    /** La lista con precios y cálculos. {@code live}: precios casi en directo (la lista está en pantalla). */
    @GetMapping("/{id}/watchlist")
    public WatchlistView watchlist(@AuthenticationPrincipal CurrentUser user, @PathVariable Long id,
                                   @RequestParam(required = false) @Pattern(regexp = "1|true") String force,
                                   @RequestParam(required = false) @Pattern(regexp = "1|true") String live) {
        return views.view(user.id(), id, force != null, live != null ? MarketController.LIVE_MAX_AGE_MS : null);
    }

    @PostMapping("/{id}/import")
    public ImportResponse importItems(@AuthenticationPrincipal CurrentUser user, @PathVariable Long id,
                                      @Valid @RequestBody ImportRequest request) {
        return items.importRows(user.id(), id, request.items());
    }
}
