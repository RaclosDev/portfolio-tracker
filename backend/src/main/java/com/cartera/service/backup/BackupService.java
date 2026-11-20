package com.cartera.service.backup;

import com.cartera.dto.ItemRequest;
import com.cartera.dto.ItemResponse;
import com.cartera.dto.ListResponse;
import com.cartera.dto.backup.BackupDtos.Backup;
import com.cartera.dto.backup.BackupDtos.BackupList;
import com.cartera.dto.backup.BackupDtos.BackupPortfolio;
import com.cartera.dto.backup.BackupDtos.RestoreResponse;
import com.cartera.dto.backup.BackupDtos.SnapshotInfo;
import com.cartera.dto.portfolio.InstrumentRequest;
import com.cartera.dto.portfolio.InstrumentResponse;
import com.cartera.dto.portfolio.OperationRequest;
import com.cartera.dto.portfolio.OperationResponse;
import com.cartera.exception.ApiException;
import com.cartera.model.Instrument;
import com.cartera.model.Operation;
import com.cartera.model.Snapshot;
import com.cartera.model.WatchItem;
import com.cartera.repository.InstrumentRepository;
import com.cartera.repository.OperationRepository;
import com.cartera.repository.SnapshotRepository;
import com.cartera.repository.WatchItemRepository;
import com.cartera.repository.WatchListRepository;
import com.cartera.service.SettingsService;
import com.cartera.service.portfolio.PortfolioMapper;
import com.cartera.service.portfolio.PortfolioService;
import com.cartera.service.watchlist.WatchItemService;
import com.cartera.service.watchlist.WatchListService;
import com.cartera.util.JsonPatches;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Copias de seguridad: exportar e importar todos los datos de un usuario (listas, ajustes y cartera) y las copias que
 * se guardan en la base de datos antes de cada importación.
 */
@Service
@RequiredArgsConstructor
public class BackupService {

    /** Copias guardadas en la base de datos que se conservan (las más recientes). */
    private static final int KEEP_SNAPSHOTS = 40;
    private static final String DEFAULT_LIST = "Vigilar nuevas";
    private static final DateTimeFormatter SAVED_AT = DateTimeFormatter.ofPattern("d/M/yyyy, H:mm:ss")
            .withZone(ZoneId.of("Europe/Madrid"));

    private final SnapshotRepository snapshots;
    private final WatchListRepository lists;
    private final WatchItemRepository items;
    private final WatchListService listService;
    private final WatchItemService itemService;
    private final OperationRepository operations;
    private final InstrumentRepository instruments;
    private final SettingsService settings;
    private final JsonPatches patches;

    @Transactional(readOnly = true)
    public Backup export(UUID userId) {
        List<BackupList> out = new ArrayList<>();
        for (ListResponse l : lists.summaries(userId)) {
            List<ObjectNode> rows = new ArrayList<>();
            for (WatchItem item : items.findByListIdOrderByPositionAscIdAsc(l.id())) {
                ObjectNode row = patches.tree(ItemResponse.of(item));
                row.remove(List.of("id", "listId", "createdAt", "updatedAt"));
                rows.add(row);
            }
            out.add(new BackupList(l.name(), rows));
        }
        BackupPortfolio portfolio = new BackupPortfolio(
                instruments.findByUserIdOrderByTicker(userId).stream().map(InstrumentResponse::of).toList(),
                operations.findAllOrdered(userId).stream().map(o -> OperationResponse.of(o).toRequest()).toList());
        return new Backup(1, Instant.now().toString(), patches.tree(settings.get(userId)), out, portfolio);
    }

    /**
     * Reemplaza todas las listas y valores por el contenido de la copia (y la cartera, si la copia la trae: las copias
     * antiguas no la tienen y no deben borrarla; sus «positions» del formato viejo se ignoran). Antes guarda lo que
     * había como copia.
     */
    @Transactional
    public RestoreResponse restore(UUID userId, JsonNode raw) {
        Parsed data = parse(raw);
        // Nada se cuela entre la copia previa y el reemplazo (altas de operaciones, valores o listas a la vez).
        operations.lockPortfolio(userId);
        lists.lockAllByUser(userId);
        Snapshot saved = save(userId, "antes de importar", true);

        lists.deleteByUser(userId);
        lists.flush();
        if (data.settings() != null) settings.update(userId, data.settings());
        int count = 0;
        for (ParsedList l : data.lists()) {
            ListResponse list = listService.create(userId, l.name());
            for (ObjectNode row : l.items()) {
                row.put("listId", list.id());
                itemService.create(userId, patches.convert(row, ItemRequest.class, null));
                count++;
            }
        }
        if (data.lists().isEmpty()) listService.create(userId, DEFAULT_LIST);

        if (data.portfolio() != null) {
            operations.deleteByUser(userId);
            instruments.deleteByUser(userId);
            for (InstrumentRequest i : data.portfolio().instruments()) {
                Instrument row = new Instrument(userId, i.ticker());
                PortfolioMapper.apply(row, i);
                instruments.save(row);
            }
            for (OperationRequest o : data.portfolio().operations()) operations.save(toOperation(userId, o));
            PortfolioService.assertValid(operations.findAllOrdered(userId), instruments.findByUserIdOrderByTicker(userId));
        }
        return new RestoreResponse(data.lists().size(), count,
                data.portfolio() == null ? 0 : data.portfolio().operations().size(),
                saved == null ? null : "la copia del " + SAVED_AT.format(saved.getCreatedAt()));
    }

    /** Guarda una copia completa en la base de datos y borra las más antiguas. Devuelve su id (o null si no hizo falta). */
    @Transactional
    public Long snapshot(UUID userId, String reason, boolean skipIfEmpty) {
        Snapshot s = save(userId, reason, skipIfEmpty);
        return s == null ? null : s.getId();
    }

    @Transactional(readOnly = true)
    public List<SnapshotInfo> listSnapshots(UUID userId) {
        return snapshots.summaries(userId).stream()
                .map(s -> new SnapshotInfo(s.getId(), s.getCreatedAt(), s.getReason(), s.getItems(), s.getOperations()))
                .toList();
    }

    @Transactional(readOnly = true)
    public JsonNode getSnapshot(UUID userId, Long id) {
        return snapshots.findByIdAndUserId(id, userId).map(s -> patches.readTree(s.getData()))
                .orElseThrow(() -> ApiException.notFound("Copia no encontrada."));
    }

    @Transactional
    public RestoreResponse restoreSnapshot(UUID userId, Long id) {
        return restore(userId, getSnapshot(userId, id));
    }

    // ------------------------------------------------------------------------------------------------------------

    private Snapshot save(UUID userId, String reason, boolean skipIfEmpty) {
        Backup data = export(userId);
        int itemCount = data.lists().stream().mapToInt(l -> l.items().size()).sum();
        if (skipIfEmpty && itemCount == 0 && data.portfolio().operations().isEmpty()) return null;
        Snapshot s = snapshots.saveAndFlush(new Snapshot(userId, reason, patches.write(data)));
        snapshots.prune(userId, KEEP_SNAPSHOTS);
        return s;
    }

    private record ParsedList(String name, List<ObjectNode> items) {
    }

    private record ParsedPortfolio(List<InstrumentRequest> instruments, List<OperationRequest> operations) {
    }

    private record Parsed(JsonNode settings, List<ParsedList> lists, ParsedPortfolio portfolio) {
    }

    /** Valida la copia entera antes de borrar nada: una copia a medias no deja los datos a medias. */
    private Parsed parse(JsonNode raw) {
        if (raw == null || !raw.isObject()) throw ApiException.badRequest("La copia no es válida.");
        if (raw.path("version").asInt(0) != 1) throw ApiException.badRequest("version: la copia debe ser de la versión 1");
        JsonNode rawLists = raw.get("lists");
        if (rawLists == null || !rawLists.isArray()) throw ApiException.badRequest("lists: falta la lista de listas");
        List<ParsedList> parsedLists = new ArrayList<>();
        int li = 0;
        for (JsonNode l : rawLists) {
            String prefix = "lists." + li++;
            String name = l.path("name").asString("").trim();
            if (name.isEmpty()) throw ApiException.badRequest(prefix + ".name: falta el nombre");
            List<ObjectNode> rows = new ArrayList<>();
            int ii = 0;
            for (JsonNode it : l.path("items")) {
                if (!it.isObject()) throw ApiException.badRequest(prefix + ".items." + ii + ": no es un valor");
                ObjectNode row = ((ObjectNode) it).deepCopy();
                row.remove("listId");
                // Se valida ya con una lista cualquiera; al restaurar se pone la nueva.
                ObjectNode probe = row.deepCopy();
                probe.put("listId", 1);
                patches.convert(probe, ItemRequest.class, prefix + ".items." + ii++);
                rows.add(row);
            }
            parsedLists.add(new ParsedList(name, rows));
        }
        JsonNode settingsNode = raw.get("settings");
        if (settingsNode != null && !settingsNode.isObject()) settingsNode = null;
        ParsedPortfolio portfolio = null;
        JsonNode p = raw.get("portfolio");
        if (p != null && p.isObject()) {
            List<InstrumentRequest> ins = new ArrayList<>();
            int i = 0;
            for (JsonNode n : p.path("instruments")) {
                ins.add(patches.convert(n, InstrumentRequest.class, "portfolio.instruments." + i++));
            }
            List<OperationRequest> ops = new ArrayList<>();
            i = 0;
            for (JsonNode n : p.path("operations")) {
                ops.add(patches.convert(n, OperationRequest.class, "portfolio.operations." + i++));
            }
            portfolio = new ParsedPortfolio(ins, ops);
        }
        return new Parsed(settingsNode, parsedLists, portfolio);
    }

    private static Operation toOperation(UUID userId, OperationRequest r) {
        Operation o = new Operation();
        o.setUserId(userId);
        PortfolioMapper.apply(o, r);
        return o;
    }
}
