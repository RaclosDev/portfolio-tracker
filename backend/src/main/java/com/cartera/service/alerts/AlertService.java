package com.cartera.service.alerts;

import com.cartera.dto.ItemResponse;
import com.cartera.dto.Settings;
import com.cartera.dto.WatchlistView;
import com.cartera.dto.WatchlistView.Row;
import com.cartera.dto.alerts.AlertDtos.Alert;
import com.cartera.dto.alerts.AlertDtos.AlertEntry;
import com.cartera.dto.alerts.AlertDtos.AlertKind;
import com.cartera.dto.alerts.AlertDtos.PushPayload;
import com.cartera.dto.alerts.AlertDtos.SendResult;
import com.cartera.dto.alerts.AlertDtos.TouchedOrderResponse;
import com.cartera.event.UserDataChangedEvent;
import com.cartera.model.AlertRecord;
import com.cartera.model.AlertState;
import com.cartera.model.TouchedOrder;
import com.cartera.model.WatchItem;
import com.cartera.repository.AlertRecordRepository;
import com.cartera.repository.AlertStateRepository;
import com.cartera.repository.TouchedOrderRepository;
import com.cartera.repository.WatchItemRepository;
import com.cartera.service.backup.BackupService;
import com.cartera.service.watchlist.WatchlistViewService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Vigilancia de precios: en cada comprobación calcula el estado de todos los valores de las listas del usuario,
 * decide qué avisar, lo guarda en el historial y lo envía a sus dispositivos. También apunta las órdenes que ha
 * tocado el precio, manda el resumen diario y hace la copia diaria.
 *
 * <p>Una comprobación sin novedades no toca la base de datos: las listas y los ajustes salen de {@link AlertWorkset}, y
 * el estado de avisos y las órdenes ya apuntadas se guardan en memoria. Solo se escribe cuando algo cambia (un aviso,
 * una orden tocada, un valor que cambia de tramo, el resumen o la copia del día).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AlertService {

    static final ZoneId MADRID = ZoneId.of("Europe/Madrid");
    private static final int HISTORY_KEEP = 500;
    private static final int HISTORY_LIMIT = 200;

    private final AlertRecordRepository history;
    private final AlertStateRepository states;
    private final TouchedOrderRepository touched;
    private final WatchItemRepository items;
    private final WatchlistViewService watchlist;
    private final BackupService backup;
    private final WebPushService push;
    private final JsonMapper json;
    private final TransactionTemplate tx;
    private final AlertWorkset workset;

    /** Usuarios con una comprobación en marcha: no se solapan dos del mismo. */
    private final Set<UUID> running = ConcurrentHashMap.newKeySet();
    /** Estado de avisos de cada usuario: se lee una vez y se escribe solo cuando cambia. */
    private final Map<UUID, AlertState> stateCache = new ConcurrentHashMap<>();
    /** Órdenes ya apuntadas de cada usuario ({@link #touchedKey}): se leen una vez. */
    private final Map<UUID, Set<String>> touchedCache = new ConcurrentHashMap<>();

    /** El usuario ha cambiado algo (ha podido descartar órdenes o borrar la cuenta): se vuelve a leer. */
    @EventListener
    public void onUserDataChanged(UserDataChangedEvent event) {
        forget(event.userId());
    }

    private void forget(UUID userId) {
        stateCache.remove(userId);
        touchedCache.remove(userId);
    }

    /**
     * Una comprobación completa. {@code force}: ignora fines de semana, horas de silencio y el interruptor de
     * avisos (botón «Comprobar ahora»). {@code maxAgeMs}: antigüedad máxima de los precios (null: la normal).
     */
    public List<Alert> tick(UUID userId, Instant now, boolean force, Long maxAgeMs) {
        if (!running.add(userId)) return List.of();
        try {
            AlertWorkset.UserData data = workset.get(userId);
            if (data == null) {
                forget(userId);
                return List.of();
            }
            ZonedDateTime local = now.atZone(MADRID);
            LocalDate today = local.toLocalDate();
            AlertState state = stateCache.computeIfAbsent(userId,
                    id -> states.findById(id).orElseGet(() -> new AlertState(id)));
            String memoryBefore = state.getMemory();
            LocalDate summaryBefore = state.getLastSummaryOn();
            LocalDate backupBefore = state.getLastBackupOn();
            try {
                return check(userId, data, now, local, today, state, force, maxAgeMs);
            } finally {
                boolean changed = state.getLastCheckedAt() == null
                        || !Objects.equals(state.getMemory(), memoryBefore)
                        || !Objects.equals(state.getLastSummaryOn(), summaryBefore)
                        || !Objects.equals(state.getLastBackupOn(), backupBefore);
                if (changed) {
                    state.setLastCheckedAt(now);
                    stateCache.put(userId, states.save(state));
                }
            }
        } finally {
            running.remove(userId);
        }
    }

    private List<Alert> check(UUID userId, AlertWorkset.UserData data, Instant now, ZonedDateTime local,
                              LocalDate today, AlertState state, boolean force, Long maxAgeMs) {
        dailySnapshot(userId, today, state);
        Settings s = data.settings();
        Settings.Notifications n = s.notifications();
        String hhmm = AlertRules.hhmm(local.toLocalTime());
        if (!force) {
            DayOfWeek day = local.getDayOfWeek();
            if (n.skipWeekends() && (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY)) return List.of();
            if (n.quietHours() && AlertRules.inTimeRange(hhmm, n.quietFrom(), n.quietTo())) return List.of();
        }

        List<Row> rows = rows(data, maxAgeMs);
        // Las órdenes tocadas se apuntan siempre, también con los avisos apagados: quedan para revisarlas en la app.
        recordTouched(userId, rows, now);
        if (!force && !n.enabled()) return List.of();

        List<Row> watched = rows.stream().filter(r -> !AlertRules.isMuted(r.item().mutedUntil(), today)).toList();
        AlertRules.Memory before = memory(state);
        // Si han cambiado los tramos, el primer repaso solo recoloca los estados: mover un umbral no es que el precio
        // se haya acercado, así que no se avisa de «muy cerca» (sí de «en zona»).
        String bands = AlertRules.num(s.bands().veryNear()) + "/" + AlertRules.num(s.bands().near()) + "/"
                + AlertRules.num(s.bands().far());
        boolean rebase = !bands.equals(before.bands());
        AlertRules.Evaluation result = AlertRules.evaluate(watched,
                before, new AlertRules.Prefs(n.reached(), n.near(), n.orders()), now);
        List<Alert> alerts = result.alerts().stream().filter(a -> !(rebase && a.kind() == AlertKind.near)).toList();
        AlertRules.Memory memory = result.memory().withBands(bands);
        if (!memory.equals(before)) state.setMemory(json.writeValueAsString(memory));

        if (!alerts.isEmpty()) {
            saveHistory(userId, alerts, now);
            for (Alert a : alerts) {
                push.sendAll(userId, new PushPayload(a.title(), a.body(), a.kind() + "-" + a.itemId(), "/"));
            }
            log.info("{} aviso(s): {}", alerts.size(), alerts.stream().map(Alert::title).collect(Collectors.joining(" | ")));
        }

        // Resumen del día: una vez, a partir de la hora elegida.
        if (n.dailySummary() && hhmm.compareTo(n.dailySummaryAt()) >= 0 && !today.equals(state.getLastSummaryOn())) {
            AlertRules.Summary summary = AlertRules.dailySummary(rows, today, s.statusNames());
            SendResult res = summary == null ? null
                    : push.sendAll(userId, new PushPayload(summary.title(), summary.body(), "resumen", "/"));
            // Solo se da por enviado si llegó a algún dispositivo (o no había a quién): si fallan todos, se reintenta.
            if (res == null || res.sent() > 0 || res.failed() == 0) state.setLastSummaryOn(today);
        }
        return alerts;
    }

    /**
     * Todas las filas de todas las listas, con los datos en memoria y los precios de la caché de mercado. Un valor
     * puede estar en varias listas con niveles distintos.
     */
    private List<Row> rows(AlertWorkset.UserData data, Long maxAgeMs) {
        List<Row> rows = new ArrayList<>();
        for (AlertWorkset.ListData l : data.lists()) {
            if (l.items().isEmpty()) continue;
            WatchlistView view = watchlist.build(l.list(), l.items(), data.settings(), false, maxAgeMs);
            rows.addAll(view.rows());
        }
        return rows;
    }

    /** Apunta las órdenes activas cuyo precio ya ha tocado la cotización (una vez por orden y precio). */
    public void recordTouched(UUID userId, List<Row> rows, Instant now) {
        Set<String> known = touchedCache.get(userId);
        for (Row row : rows) {
            ItemResponse item = row.item();
            Double price = row.quote() == null || row.quote().stale() ? null : row.quote().price();
            Double orderPrice = item.orderPrice();
            if (!item.orderActive() || orderPrice == null || orderPrice == 0 || price == null || price > orderPrice) continue;
            if (known == null) {
                known = touched.findByUserIdOrderByTouchedAtAscIdAsc(userId).stream()
                        .map(t -> touchedKey(t.getItemId(), t.getOrderPrice()))
                        .collect(Collectors.toCollection(ConcurrentHashMap::newKeySet));
                touchedCache.put(userId, known);
            }
            // Un valor puede estar en varias listas: el add evita apuntarlo dos veces en la misma vuelta.
            if (!known.add(touchedKey(item.id(), orderPrice))) continue;
            TouchedOrder t = new TouchedOrder();
            t.setUserId(userId);
            t.setItemId(item.id());
            t.setOrderPrice(orderPrice);
            t.setPrice(price);
            if (row.quote().currency() != null) t.setCurrency(row.quote().currency());
            Integer shares = item.sharesOverride() != null ? item.sharesOverride() : row.metrics().shares();
            t.setShares(shares == null ? null : shares.doubleValue());
            t.setTouchedAt(now);
            try {
                touched.saveAndFlush(t);
            } catch (DataIntegrityViolationException e) {
                // Otra comprobación la apuntó a la vez.
            }
        }
    }

    private static String touchedKey(Long itemId, double orderPrice) {
        return itemId + "@" + Double.doubleToLongBits(orderPrice);
    }

    /** Órdenes tocadas pendientes de revisar. Se olvidan solas si la orden se quita o cambia de precio. */
    @Transactional
    public List<TouchedOrderResponse> touchedOrders(UUID userId) {
        // Si se olvida alguna, la lista en memoria ya no vale.
        if (touched.forgetStale(userId) > 0) touchedCache.remove(userId);
        List<TouchedOrder> pending = touched.findByUserIdOrderByTouchedAtAscIdAsc(userId).stream()
                .filter(t -> !t.isDismissed()).toList();
        Map<Long, WatchItem> byId = items.findAllById(pending.stream().map(TouchedOrder::getItemId).toList()).stream()
                .collect(Collectors.toMap(WatchItem::getId, Function.identity()));
        return pending.stream().filter(t -> byId.containsKey(t.getItemId())).map(t -> {
            WatchItem i = byId.get(t.getItemId());
            return new TouchedOrderResponse(t.getItemId(), i.getList().getId(), i.getSymbol(), i.getTicker(),
                    i.getIsin(), i.getName(), t.getCurrency(), t.getOrderPrice(), t.getPrice(), t.getShares(),
                    i.getBrokerName(), AlertRules.iso(t.getTouchedAt()));
        }).toList();
    }

    /** Comprueba ahora las órdenes de todas las listas y devuelve las pendientes. */
    public List<TouchedOrderResponse> checkTouched(UUID userId) {
        AlertWorkset.UserData data = workset.get(userId);
        if (data != null) recordTouched(userId, rows(data, null), Instant.now());
        return touchedOrders(userId);
    }

    /**
     * Descarta una orden tocada (ya apuntada en la cartera o no se ejecutó). Se recuerda como descartada mientras la
     * orden siga activa a ese precio, para que no vuelva a salir en la siguiente vuelta.
     */
    @Transactional
    public void dismissTouched(UUID userId, Long itemId) {
        touched.dismiss(userId, itemId);
    }

    @Transactional(readOnly = true)
    public List<AlertEntry> history(UUID userId) {
        return history.findByUserIdOrderByIdDesc(userId, Limit.of(HISTORY_LIMIT)).stream()
                .map(r -> new AlertEntry(AlertRules.iso(r.getAt()), r.getKind(), r.getItemId(), r.getSymbol(),
                        r.getTitle(), r.getBody(), "servidor"))
                .toList();
    }

    private void saveHistory(UUID userId, List<Alert> alerts, Instant now) {
        tx.executeWithoutResult(status -> {
            for (Alert a : alerts) {
                AlertRecord r = new AlertRecord();
                r.setUserId(userId);
                r.setAt(now);
                r.setKind(a.kind().name());
                r.setItemId(a.itemId());
                r.setSymbol(a.symbol());
                r.setTitle(a.title());
                r.setBody(a.body());
                history.save(r);
            }
            history.flush();
            history.trim(userId, HISTORY_KEEP);
        });
    }

    /** Una copia completa al día dentro de la base de datos (se guardan las últimas). */
    private void dailySnapshot(UUID userId, LocalDate today, AlertState state) {
        if (today.equals(state.getLastBackupOn())) return;
        // Primero la copia y luego la marca: si la copia falla, se vuelve a intentar en la siguiente vuelta.
        backup.snapshot(userId, "diaria", true);
        state.setLastBackupOn(today);
    }

    private AlertRules.Memory memory(AlertState state) {
        try {
            return json.readValue(state.getMemory(), AlertRules.Memory.class);
        } catch (RuntimeException e) {
            log.warn("Memoria de avisos ilegible; se empieza de cero: {}", e.toString());
            return new AlertRules.Memory(null, null, null);
        }
    }
}
