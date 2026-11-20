package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.ItemRequest;
import com.cartera.dto.ItemResponse;
import com.cartera.service.watchlist.WatchItemService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/items")
@RequiredArgsConstructor
public class WatchItemController {

    private final WatchItemService items;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ItemResponse create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody ItemRequest request) {
        return items.create(user.id(), request);
    }

    /** Solo los campos que cambian; {@code null} vacía el campo. */
    @PatchMapping(path = "/{id}", consumes = {"application/json", "application/merge-patch+json"})
    public ItemResponse update(@AuthenticationPrincipal CurrentUser user, @PathVariable Long id,
                               @RequestBody JsonNode patch) {
        return items.update(user.id(), id, patch);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal CurrentUser user, @PathVariable Long id) {
        items.delete(user.id(), id);
    }
}
