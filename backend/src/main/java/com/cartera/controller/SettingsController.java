package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.Settings;
import com.cartera.service.SettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/settings")
@RequiredArgsConstructor
public class SettingsController {

    private final SettingsService settings;

    @GetMapping
    public Settings get(@AuthenticationPrincipal CurrentUser user) {
        return settings.get(user.id());
    }

    /** Solo los ajustes que cambian; un {@code null} devuelve el ajuste a su valor de serie. */
    @PatchMapping(consumes = {"application/json", "application/merge-patch+json"})
    public Settings update(@AuthenticationPrincipal CurrentUser user, @RequestBody JsonNode patch) {
        return settings.update(user.id(), patch);
    }
}
