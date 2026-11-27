package com.cartera.service.watchlist;

import com.cartera.dto.ListResponse;
import com.cartera.event.UserCreatedEvent;
import com.cartera.exception.ApiException;
import com.cartera.service.Quotas;
import com.cartera.model.WatchList;
import com.cartera.repository.WatchItemRepository;
import com.cartera.repository.WatchListRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/** Listas de vigilancia del usuario. */
@Service
@RequiredArgsConstructor
public class WatchListService {

    public static final String DEFAULT_LIST_NAME = "Vigilar nuevas";
    private static final String DUPLICATE = "Ya tienes una lista con ese nombre.";

    private final WatchListRepository lists;
    private final WatchItemRepository items;

    /** Toda cuenta nueva empieza con una lista vacía (en la misma transacción que la crea). */
    @EventListener
    public void onUserCreated(UserCreatedEvent event) {
        lists.save(WatchList.builder().userId(event.userId()).name(DEFAULT_LIST_NAME).position(1).build());
    }

    @Transactional(readOnly = true)
    public List<ListResponse> all(UUID userId) {
        return lists.summaries(userId);
    }

    @Transactional(readOnly = true)
    public WatchList owned(UUID userId, Long id) {
        return lists.findByIdAndUserId(id, userId).orElseThrow(() -> ApiException.notFound("Lista no encontrada."));
    }

    @Transactional
    public ListResponse create(UUID userId, String name) {
        Quotas.check(lists.countByUserId(userId) + 1, Quotas.MAX_LISTS, "listas");
        WatchList list = WatchList.builder().userId(userId).name(name).position(lists.maxPosition(userId) + 1).build();
        try {
            lists.saveAndFlush(list);
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict(DUPLICATE);
        }
        return new ListResponse(list.getId(), list.getName(), 0);
    }

    @Transactional
    public ListResponse rename(UUID userId, Long id, String name) {
        WatchList list = owned(userId, id);
        list.setName(name);
        try {
            lists.flush();
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict(DUPLICATE);
        }
        return new ListResponse(list.getId(), list.getName(), items.countByList(id));
    }

    /** Borra la lista y sus valores. Se bloquean todas las del usuario para no quedarse nunca sin ninguna. */
    @Transactional
    public void delete(UUID userId, Long id) {
        List<WatchList> all = lists.lockAllByUser(userId);
        WatchList list = all.stream().filter(l -> l.getId().equals(id)).findFirst()
                .orElseThrow(() -> ApiException.notFound("Lista no encontrada."));
        if (all.size() <= 1) throw ApiException.badRequest("Debe quedar al menos una lista.");
        lists.delete(list);
    }
}
