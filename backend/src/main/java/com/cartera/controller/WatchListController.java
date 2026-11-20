package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.ImportRequest;
import com.cartera.dto.ImportResponse;
import com.cartera.dto.ListRequest;
import com.cartera.dto.ListResponse;
import com.cartera.service.watchlist.WatchItemService;
import com.cartera.service.watchlist.WatchListService;
import jakarta.validation.Valid;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/lists")
@RequiredArgsConstructor
public class WatchListController {

    private final WatchListService lists;
    private final WatchItemService items;

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

    @PostMapping("/{id}/import")
    public ImportResponse importItems(@AuthenticationPrincipal CurrentUser user, @PathVariable Long id,
                                      @Valid @RequestBody ImportRequest request) {
        return items.importRows(user.id(), id, request.items());
    }
}
