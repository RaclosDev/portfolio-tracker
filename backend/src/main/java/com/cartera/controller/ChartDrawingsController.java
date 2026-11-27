package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.ChartDrawing;
import com.cartera.service.ChartDrawingsService;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
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
    public ResponseEntity<List<ChartDrawing>> get(@AuthenticationPrincipal CurrentUser user,
                                                  @PathVariable @Size(min = 1, max = 32) String symbol) {
        return versioned(drawings.get(user.id(), symbol));
    }

    /** Con {@code If-Match} (el ETag del GET o del PUT anterior), responde 409 si la lista ya ha cambiado. */
    @PutMapping("/{symbol}")
    public ResponseEntity<List<ChartDrawing>> save(@AuthenticationPrincipal CurrentUser user,
                                                   @PathVariable @Size(min = 1, max = 32) String symbol,
                                                   @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
                                                   @RequestBody JsonNode body) {
        return versioned(drawings.save(user.id(), symbol, body, ifMatch));
    }

    private static ResponseEntity<List<ChartDrawing>> versioned(ChartDrawingsService.Versioned result) {
        return ResponseEntity.ok().eTag("\"" + result.version() + "\"").body(result.drawings());
    }
}
