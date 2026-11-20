package com.cartera.service.alerts;

import com.cartera.dto.ItemResponse;
import com.cartera.dto.ListResponse;
import com.cartera.dto.Settings;
import com.cartera.event.UserDataChangedEvent;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import com.cartera.repository.WatchItemRepository;
import com.cartera.service.SettingsService;
import com.cartera.service.watchlist.WatchListService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Lo que el vigilante de avisos necesita de cada usuario (sus listas con niveles y órdenes, y sus ajustes), guardado
 * en memoria. Se lee de la base de datos una vez y solo se vuelve a leer cuando ese usuario cambia algo
 * ({@link UserDataChangedEvent}) o en la recarga completa de seguridad cada pocas horas. Así la base de datos puede
 * dormirse mientras nadie usa la app, aunque el vigilante compruebe los precios cada pocos segundos.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AlertWorkset {

    /** Una lista con sus valores, tal como se guardan (sin precios). */
    public record ListData(ListResponse list, List<ItemResponse> items) {
    }

    /** Todo lo de un usuario que hace falta para comprobar sus avisos. */
    public record UserData(Settings settings, List<ListData> lists) {
    }

    private final UserRepository users;
    private final WatchListService lists;
    private final WatchItemRepository items;
    private final SettingsService settings;
    private final TransactionTemplate tx;

    private final Map<UUID, UserData> data = new ConcurrentHashMap<>();
    /** Cuántos cambios lleva cada usuario: si llega uno mientras se lee, lo leído ya no vale y no se guarda. */
    private final Map<UUID, Long> changes = new ConcurrentHashMap<>();
    /** Usuarios conocidos; null hasta la primera carga o tras {@link #reloadAll()}. */
    private volatile Set<UUID> known;

    /** Usuarios a vigilar. La primera vez (y tras {@link #reloadAll()}) se leen de la base de datos. */
    public Set<UUID> users() {
        Set<UUID> ids = known;
        if (ids == null) {
            ids = ConcurrentHashMap.newKeySet();
            for (User u : users.findAll()) ids.add(u.getId());
            known = ids;
        }
        return Set.copyOf(ids);
    }

    /** Los datos del usuario, de memoria o, si han cambiado, recién leídos. null si el usuario ya no existe. */
    public UserData get(UUID userId) {
        UserData cached = data.get(userId);
        if (cached != null) return cached;
        long before = changes.getOrDefault(userId, 0L);
        UserData loaded = load(userId);
        if (loaded == null) {
            Set<UUID> ids = known;
            if (ids != null) ids.remove(userId);
            return null;
        }
        if (changes.getOrDefault(userId, 0L) == before) data.put(userId, loaded);
        return loaded;
    }

    /** Ha cambiado algo del usuario: se recarga en la siguiente vuelta. Un usuario nuevo empieza a vigilarse. */
    @EventListener
    public void onUserDataChanged(UserDataChangedEvent event) {
        changes.merge(event.userId(), 1L, Long::sum);
        data.remove(event.userId());
        Set<UUID> ids = known;
        if (ids != null) ids.add(event.userId());
    }

    /** Lo olvida todo; se vuelve a leer de la base de datos según se necesite. */
    public void reloadAll() {
        data.clear();
        known = null;
    }

    private UserData load(UUID userId) {
        return tx.execute(status -> {
            if (!users.existsById(userId)) return null;
            List<ListData> out = new ArrayList<>();
            for (ListResponse l : lists.all(userId)) {
                List<ItemResponse> rows = items.findByListIdOrderByPositionAscIdAsc(l.id()).stream().map(ItemResponse::of).toList();
                out.add(new ListData(new ListResponse(l.id(), l.name(), rows.size()), rows));
            }
            return new UserData(settings.get(userId), List.copyOf(out));
        });
    }
}
