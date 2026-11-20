package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.ChartDrawing;
import com.cartera.service.ChartDrawingsService;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.List;

/** Dibujos del gráfico de velas de cada valor; se guardan todos juntos al cambiar uno. */
@RestController
@RequestMapping("/api/drawings")
@RequiredArgsConstructor
public class ChartDrawingsController {

    private final ChartDrawingsService drawings;

    @GetMapping("/{symbol}")
    public List<ChartDrawing> get(@AuthenticationPrincipal CurrentUser user,
                                  @PathVariable @Size(min = 1, max = 32) String symbol) {
        return drawings.get(user.id(), symbol);
    }

    @PutMapping("/{symbol}")
    public List<ChartDrawing> save(@AuthenticationPrincipal CurrentUser user,
                                   @PathVariable @Size(min = 1, max = 32) String symbol,
                                   @RequestBody JsonNode body) {
        return drawings.save(user.id(), symbol, body);
    }
}
