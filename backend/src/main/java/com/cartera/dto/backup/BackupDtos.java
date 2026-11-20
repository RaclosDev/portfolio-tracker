package com.cartera.dto.backup;

import com.cartera.dto.portfolio.InstrumentResponse;
import com.cartera.dto.portfolio.OperationRequest;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.List;

/** Formato de las copias de seguridad (el mismo fichero que se descarga y que se guarda en la base de datos). */
public final class BackupDtos {

    private BackupDtos() {
    }

    public record Backup(int version, String exportedAt, ObjectNode settings, List<BackupList> lists,
                         BackupPortfolio portfolio) {
    }

    /** Una lista con sus valores, sin ids: al restaurar se crean de nuevo. */
    public record BackupList(String name, List<ObjectNode> items) {
    }

    public record BackupPortfolio(List<InstrumentResponse> instruments, List<OperationRequest> operations) {
    }

    public record SnapshotInfo(Long id, Instant createdAt, String reason, int items, int operations) {
    }

    /** {@code savedTo}: dónde quedó lo que había antes («la copia del 20/11/2026, 10:15:00»). */
    public record RestoreResponse(int lists, int items, int operations, String savedTo) {
    }
}
