package com.cartera.controller;

import com.cartera.config.CurrentUser;
import com.cartera.dto.backup.BackupDtos.Backup;
import com.cartera.dto.backup.BackupDtos.RestoreResponse;
import com.cartera.dto.backup.BackupDtos.SnapshotInfo;
import com.cartera.service.backup.BackupService;
import jakarta.validation.constraints.Positive;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.time.LocalDate;
import java.util.List;

/** Copias de seguridad: descargar todo, restaurar un fichero y las copias guardadas antes de cada importación. */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class BackupController {

    private final BackupService backup;

    @GetMapping("/backup")
    public ResponseEntity<Backup> export(@AuthenticationPrincipal CurrentUser user) {
        return attachment("watchlist-" + LocalDate.now() + ".json", backup.export(user.id()));
    }

    /** Reemplaza listas, ajustes y cartera por los de la copia (antes guarda lo que había). */
    @PostMapping("/backup")
    public RestoreResponse restore(@AuthenticationPrincipal CurrentUser user, @RequestBody JsonNode body) {
        return backup.restore(user.id(), body);
    }

    @GetMapping("/snapshots")
    public List<SnapshotInfo> snapshots(@AuthenticationPrincipal CurrentUser user) {
        return backup.listSnapshots(user.id());
    }

    @GetMapping("/snapshots/{id}")
    public ResponseEntity<JsonNode> snapshot(@AuthenticationPrincipal CurrentUser user,
                                             @PathVariable @Positive Long id) {
        return attachment("watchlist-copia-" + id + ".json", backup.getSnapshot(user.id(), id));
    }

    @PostMapping("/snapshots/{id}/restore")
    public RestoreResponse restoreSnapshot(@AuthenticationPrincipal CurrentUser user,
                                           @PathVariable @Positive Long id) {
        return backup.restoreSnapshot(user.id(), id);
    }

    private static <T> ResponseEntity<T> attachment(String filename, T body) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .body(body);
    }
}
