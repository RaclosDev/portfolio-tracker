package com.cartera.service.watchlist;

import com.cartera.dto.ImportResponse;
import com.cartera.dto.ItemRequest;
import com.cartera.dto.ItemResponse;
import com.cartera.exception.ApiException;
import com.cartera.model.WatchItem;
import com.cartera.model.WatchList;
import com.cartera.repository.WatchItemRepository;
import com.cartera.util.JsonPatches;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Valores vigilados: alta, cambios parciales, borrado e importación desde un fichero. */
@Service
@RequiredArgsConstructor
public class WatchItemService {

    private static final String DUPLICATE = "Ese valor ya está en la lista.";

    private final WatchItemRepository items;
    private final WatchListService lists;
    private final JsonPatches patches;

    @Transactional
    public ItemResponse create(UUID userId, ItemRequest request) {
        WatchList list = lists.owned(userId, request.listId());
        WatchItem item = new WatchItem();
        item.setList(list);
        item.setPosition(items.maxPosition(list.getId()) + 1);
        apply(item, request);
        return save(item);
    }

    @Transactional
    public ItemResponse update(UUID userId, Long id, JsonNode patch) {
        if (patch == null || !patch.isObject()) throw ApiException.badRequest("La petición no es válida.");
        WatchItem item = items.findOwned(id, userId).orElseThrow(() -> ApiException.notFound("Valor no encontrado."));
        ItemRequest current = ItemResponse.of(item).toRequest();
        ObjectNode merged = patches.tree(current);
        JsonPatches.mergeShallow(merged, patch);
        ItemRequest next = patches.convert(merged, ItemRequest.class, null);
        // Con otra cotización, el ISIN anterior ya no vale si no llega uno nuevo.
        if (!next.symbol().equals(current.symbol()) && !patch.has("isin")) next = next.withIsin(null);
        if (!Objects.equals(next.listId(), current.listId())) {
            item.setList(lists.owned(userId, next.listId()));
            item.setPosition(items.maxPosition(next.listId()) + 1);
        }
        apply(item, next);
        item.setUpdatedAt(Instant.now());
        return save(item);
    }

    @Transactional
    public void delete(UUID userId, Long id) {
        items.delete(items.findOwned(id, userId).orElseThrow(() -> ApiException.notFound("Valor no encontrado.")));
    }

    /** Un valor que ya está en la lista recibe solo los campos de su fila; uno nuevo se crea. Todo o nada. */
    @Transactional
    public ImportResponse importRows(UUID userId, Long listId, List<ObjectNode> rows) {
        WatchList list = lists.owned(userId, listId);
        Map<String, WatchItem> bySymbol = new HashMap<>();
        for (WatchItem i : items.findByListIdOrderByPositionAscIdAsc(listId)) bySymbol.put(i.getSymbol(), i);
        int position = items.maxPosition(listId);
        int created = 0;
        int updated = 0;
        for (int n = 0; n < rows.size(); n++) {
            String row = "Fila " + (n + 1);
            ObjectNode patch = rows.get(n).deepCopy();
            patch.remove("listId");
            JsonNode symbol = patch.get("symbol");
            if (symbol == null || !symbol.isString() || symbol.asString().isBlank()) {
                throw ApiException.badRequest(row + " · symbol: es obligatorio");
            }
            WatchItem existing = bySymbol.get(symbol.asString().trim().toUpperCase(Locale.ROOT));
            ItemRequest base = existing != null ? ItemResponse.of(existing).toRequest() : empty(listId);
            ObjectNode merged = patches.tree(base);
            JsonPatches.mergeShallow(merged, patch);
            ItemRequest request = patches.convert(merged, ItemRequest.class, row);
            WatchItem item = existing;
            if (item == null) {
                item = new WatchItem();
                item.setList(list);
                item.setPosition(++position);
                bySymbol.put(request.symbol(), item);
                created++;
            } else {
                item.setUpdatedAt(Instant.now());
                updated++;
            }
            apply(item, request);
            save(item);
        }
        return new ImportResponse(created, updated);
    }

    private ItemResponse save(WatchItem item) {
        try {
            return ItemResponse.of(items.saveAndFlush(item));
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict(DUPLICATE);
        }
    }

    private static ItemRequest empty(Long listId) {
        return new ItemRequest(listId, null, null, null, null, null, null, null, null, null, false, null, null, null, null);
    }

    private static void apply(WatchItem item, ItemRequest r) {
        item.setSymbol(r.symbol());
        item.setTicker(r.ticker());
        item.setIsin(r.isin());
        item.setName(r.name());
        item.setBuyPrices(new ArrayList<>(r.buyPrices()));
        item.setBrokerTarget(r.brokerTarget());
        item.setBrokerName(r.brokerName());
        item.setInvestAmount(r.investAmount());
        item.setSharesOverride(r.sharesOverride());
        item.setOrderActive(r.orderActive());
        item.setOrderPrice(r.orderPrice());
        item.setOrderUntil(r.orderUntil());
        item.setNotes(r.notes());
        boolean forever = ItemRequest.MUTED_FOREVER.equals(r.mutedUntil());
        item.setMutedForever(forever);
        try {
            item.setMutedUntil(forever || r.mutedUntil() == null ? null : LocalDate.parse(r.mutedUntil()));
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("mutedUntil: la fecha no existe");
        }
    }
}
