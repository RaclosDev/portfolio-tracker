package com.cartera.service.alerts;

import com.cartera.dto.ItemResponse;
import com.cartera.dto.ListResponse;
import com.cartera.dto.Settings;
import com.cartera.dto.WatchlistView;
import com.cartera.dto.WatchlistView.LevelStatus;
import com.cartera.dto.WatchlistView.Row;
import com.cartera.dto.WatchlistView.RowMetrics;
import com.cartera.dto.alerts.AlertDtos.SendResult;
import com.cartera.dto.market.Quote;
import com.cartera.event.UserDataChangedEvent;
import com.cartera.model.AlertState;
import com.cartera.repository.AlertRecordRepository;
import com.cartera.repository.AlertStateRepository;
import com.cartera.repository.TouchedOrderRepository;
import com.cartera.repository.WatchItemRepository;
import com.cartera.service.backup.BackupService;
import com.cartera.service.watchlist.WatchlistViewService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** El vigilante no pide precios de más, no pierde avisos por fallos de lo accesorio y no repite lo ya avisado. */
class AlertServiceTest {

    /** Jueves a mediodía en Madrid. */
    private static final Instant NOON = Instant.parse("2026-11-26T11:00:00Z");

    private final UUID user = UUID.randomUUID();
    private final AlertStateRepository states = mock(AlertStateRepository.class);
    private final WatchlistViewService watchlist = mock(WatchlistViewService.class);
    private final BackupService backup = mock(BackupService.class);
    private final WebPushService push = mock(WebPushService.class);
    private final AlertWorkset workset = mock(AlertWorkset.class);
    private final AlertService service = new AlertService(mock(AlertRecordRepository.class), states,
            mock(TouchedOrderRepository.class), mock(WatchItemRepository.class), watchlist, backup, push,
            JsonMapper.builder().build(), mock(TransactionTemplate.class), workset);

    private List<Row> rows = List.of();

    @BeforeEach
    void setUp() {
        when(states.findById(user)).thenReturn(Optional.empty());
        when(states.save(any(AlertState.class))).thenAnswer(i -> i.getArgument(0));
        when(watchlist.build(any(), any(), any(), anyBoolean(), any()))
                .thenAnswer(i -> new WatchlistView(null, Settings.DEFAULTS, rows, Map.of(), List.of(), "", null));
        use(settings(true, false));
    }

    private static Settings settings(boolean enabled, boolean summary) {
        Settings d = Settings.DEFAULTS;
        Settings.Notifications n = new Settings.Notifications(enabled, true, true, true, false, false, "22:00", "08:00",
                summary, "00:00");
        return new Settings(d.baseCurrency(), d.defaultInvest(), d.bands(), d.statusNames(), d.tagNames(),
                d.blinkReached(), d.refreshSeconds(), d.colors(), d.skin(), d.theme(), d.appIcon(), d.density(),
                d.fontSize(), d.hiddenColumns(), d.extraColumns(), n);
    }

    private void use(Settings settings) {
        ItemResponse item = new ItemResponse(1L, 1L, "SAN.MC", "SAN", null, "Santander", List.of(), null, null, null,
                null, false, null, null, null, null, null, null);
        when(workset.get(user)).thenReturn(new AlertWorkset.UserData(settings,
                List.of(new AlertWorkset.ListData(new ListResponse(1L, "Lista", 1), List.of(item)))));
    }

    private static Row row(String marketState) {
        ItemResponse item = new ItemResponse(1L, 1L, "SAN.MC", "SAN", null, "Santander", List.of(), null, null, null,
                null, false, null, null, null, null, null, null);
        Quote quote = new Quote("SAN.MC", "Santander", "EUR", 10d, 0d, 10d, null, null, null, null, marketState, null,
                null, null, null, null, null, false, false);
        RowMetrics metrics = new RowMetrics(List.of(), LevelStatus.unknown, null, null, 0, null, null, null, null,
                null, null, null, null, null, false);
        return new Row(item, quote, null, metrics);
    }

    private void tick(Instant at) {
        service.tick(user, at, false, 9_500L);
    }

    @Test
    void withAlertsOffThePricesAreNotRequestedEveryTenSeconds() {
        use(settings(false, false));
        rows = List.of(row("REGULAR"));
        tick(NOON);
        tick(NOON.plusSeconds(10));
        tick(NOON.plusSeconds(20));
        verify(watchlist, times(1)).build(any(), any(), any(), anyBoolean(), any());
        tick(NOON.plus(AlertService.SLOW_INTERVAL).plusSeconds(1));
        verify(watchlist, times(2)).build(any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void withTheMarketsClosedThePricesAreNotRequestedEveryTenSeconds() {
        rows = List.of(row("CLOSED"), row("CLOSED"));
        tick(NOON);
        tick(NOON.plusSeconds(10));
        verify(watchlist, times(1)).build(any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void anOpenMarketKeepsTheNormalPace() {
        rows = List.of(row("CLOSED"), row("REGULAR"));
        tick(NOON);
        tick(NOON.plusSeconds(10));
        verify(watchlist, times(2)).build(any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void anEditByTheUserEndsTheSlowPaceAtOnce() {
        rows = List.of(row("CLOSED"));
        tick(NOON);
        service.onUserDataChanged(new UserDataChangedEvent(user));
        tick(NOON.plusSeconds(10));
        verify(watchlist, times(2)).build(any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void aFailedDailyBackupDoesNotStopTheAlertsAndIsNotRetriedEveryTick() {
        doThrow(new IllegalStateException("BD caída")).when(backup).snapshot(any(), anyString(), anyBoolean());
        rows = List.of(row("REGULAR"));
        tick(NOON);
        tick(NOON.plusSeconds(10));
        // Los precios se siguen mirando (los avisos funcionan) y la copia se intenta una sola vez por ahora.
        verify(watchlist, times(2)).build(any(), any(), any(), anyBoolean(), any());
        verify(backup, times(1)).snapshot(any(), anyString(), anyBoolean());
        tick(NOON.plus(AlertService.BACKUP_RETRY).plusSeconds(1));
        verify(backup, times(2)).snapshot(any(), anyString(), anyBoolean());
    }

    @Test
    void theDailySummaryGivesUpAfterAFewAttemptsWhenEveryDeviceFails() {
        use(settings(true, true));
        rows = List.of(row("REGULAR"));
        when(push.sendAll(any(), any())).thenReturn(new SendResult(0, 2));
        Instant at = NOON;
        for (int i = 0; i < 10; i++) {
            tick(at);
            at = at.plusSeconds(10);
        }
        // Reintentos espaciados: dentro de los mismos minutos no se manda más de una vez.
        verify(push, times(1)).sendAll(any(), any());
        for (int i = 0; i < 5; i++) {
            at = at.plus(AlertService.SUMMARY_RETRY).plusSeconds(1);
            tick(at);
        }
        verify(push, times(AlertService.MAX_SUMMARY_ATTEMPTS)).sendAll(any(), any());
    }

    @Test
    void aSummaryThatReachesADeviceIsNotSentAgain() {
        use(settings(true, true));
        rows = List.of(row("REGULAR"));
        when(push.sendAll(any(), any())).thenReturn(new SendResult(1, 0));
        tick(NOON);
        tick(NOON.plusSeconds(10));
        tick(NOON.plus(Duration.ofHours(1)));
        verify(push, times(1)).sendAll(any(), any());
    }

    @Test
    void ifTheStateCannotBeSavedTheInMemoryOneIsKeptAndSavingIsRetried() {
        when(states.save(any(AlertState.class)))
                .thenThrow(new IllegalStateException("BD caída"))
                .thenAnswer(i -> i.getArgument(0));
        rows = List.of(row("REGULAR"));
        // No lanza: el fallo de guardado no debe tirar la vuelta ni perder lo ya avisado.
        tick(NOON);
        // Un cambio del usuario no debe hacer releer el estado antiguo de la base de datos.
        service.onUserDataChanged(new UserDataChangedEvent(user));
        tick(NOON.plusSeconds(10));
        verify(states, times(2)).save(any(AlertState.class));
        verify(states, times(1)).findById(eq(user));
        // Guardado: ya no se vuelve a escribir sin cambios.
        tick(NOON.plusSeconds(20));
        verify(states, times(2)).save(any(AlertState.class));
        assertThat(rows).hasSize(1);
    }
}
