package com.cartera.service.portfolio;

import com.cartera.dto.portfolio.InstrumentRequest;
import com.cartera.dto.portfolio.InstrumentResponse;
import com.cartera.dto.portfolio.OperationRequest;
import com.cartera.dto.portfolio.OperationResponse;
import com.cartera.dto.portfolio.PortfolioDtos.BulkBrokerRequest;
import com.cartera.dto.portfolio.PortfolioDtos.BulkBrokerResponse;
import com.cartera.dto.portfolio.PortfolioDtos.ImportRequest;
import com.cartera.dto.portfolio.PortfolioDtos.ImportResponse;
import com.cartera.exception.ApiException;
import com.cartera.model.Instrument;
import com.cartera.model.Operation;
import com.cartera.repository.InstrumentRepository;
import com.cartera.repository.OperationRepository;
import com.cartera.service.backup.BackupService;
import com.cartera.util.JsonPatches;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.math.BigDecimal;
import java.math.MathContext;
import java.text.Normalizer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Altas, cambios y bajas del registro de la cartera. Cada cambio se valida sobre el registro completo dentro de la
 * misma transacción y con la cartera del usuario bloqueada: dos peticiones a la vez (dos ventas, venta y borrado…)
 * no pueden pasar la validación cada una por su lado y dejar juntas un registro que no cuadra.
 */
@Service
@RequiredArgsConstructor
public class OperationService {

    private static final MathContext TWELVE = new MathContext(12);

    private final OperationRepository operations;
    private final InstrumentRepository instruments;
    private final BackupService backup;
    private final JsonPatches patches;

    /** Alta de una operación. Crea el valor si es nuevo; falla si el registro deja de cuadrar. */
    @Transactional
    public OperationResponse create(UUID userId, JsonNode body) {
        if (body == null || !body.isObject()) throw ApiException.badRequest("La petición no es válida.");
        OperationRequest data = patches.convert(body.path("operation"), OperationRequest.class, "operation");
        JsonNode instrument = instrumentPatch(body);
        operations.lockPortfolio(userId);
        assertCurrencyUnchanged(userId, data.ticker(), currencyIn(instrument), null);
        Operation op = new Operation();
        op.setUserId(userId);
        PortfolioMapper.apply(op, data);
        operations.save(op);
        saveInstrument(userId, data.ticker(), instrument);
        assertValid(userId);
        return OperationResponse.of(op);
    }

    /** Acepta {@code {operation, instrument?}} o la operación sola. */
    @Transactional
    public OperationResponse update(UUID userId, Long id, JsonNode body) {
        if (body == null || !body.isObject()) throw ApiException.badRequest("La petición no es válida.");
        boolean wrapped = body.path("operation").isObject();
        OperationRequest data = patches.convert(wrapped ? body.get("operation") : body, OperationRequest.class,
                wrapped ? "operation" : null);
        JsonNode instrument = wrapped ? instrumentPatch(body) : null;
        operations.lockPortfolio(userId);
        assertCurrencyUnchanged(userId, data.ticker(), currencyIn(instrument), id);
        Operation op = operations.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("Operación no encontrada."));
        PortfolioMapper.apply(op, data);
        op.setUpdatedAt(Instant.now());
        saveInstrument(userId, data.ticker(), instrument);
        assertValid(userId);
        return OperationResponse.of(op);
    }

    @Transactional
    public void delete(UUID userId, Long id) {
        operations.lockPortfolio(userId);
        Operation op = operations.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("Operación no encontrada."));
        operations.delete(op);
        assertValid(userId);
    }

    /** El bróker decide el FIFO por cuenta: se valida el registro igual que en un alta. */
    @Transactional
    public BulkBrokerResponse setBroker(UUID userId, BulkBrokerRequest req) {
        operations.lockPortfolio(userId);
        int updated = operations.setBroker(userId, req.ids(), req.broker(), req.needsReview(), Instant.now());
        assertValid(userId);
        return new BulkBrokerResponse(updated);
    }

    @Transactional
    public InstrumentResponse updateInstrument(UUID userId, String ticker, JsonNode patch) {
        if (patch == null || !patch.isObject()) throw ApiException.badRequest("La petición no es válida.");
        operations.lockPortfolio(userId);
        Instrument current = instruments.findByUserIdAndTicker(userId, ticker.trim().toUpperCase())
                .orElseThrow(() -> ApiException.notFound("Valor no encontrado."));
        assertCurrencyUnchanged(userId, current.getTicker(), currencyIn(patch), null);
        ObjectNode merged = patches.tree(InstrumentResponse.of(current).toRequest());
        JsonPatches.mergeShallow(merged, patch);
        merged.put("ticker", current.getTicker());
        PortfolioMapper.apply(current, patches.convert(merged, InstrumentRequest.class, null));
        // Cambiar el ISIN junta o separa posiciones: el registro tiene que seguir cuadrando.
        if (patch.has("isin")) assertValid(userId);
        return InstrumentResponse.of(current);
    }

    /** Añade movimientos con copia previa y valida la cartera completa en una sola transacción. */
    @Transactional
    public ImportResponse importOperations(UUID userId, ImportRequest data) {
        // Serializa importaciones y altas manuales para comprobar duplicados sobre el estado definitivo.
        operations.lockPortfolio(userId);
        Set<String> seen = new HashSet<>();
        operations.findAllOrdered(userId).forEach(o -> seen.add(fingerprint(OperationResponse.of(o).toRequest())));
        boolean allowDuplicates = Boolean.TRUE.equals(data.allowDuplicates());
        List<OperationRequest> additions = new ArrayList<>();
        for (OperationRequest op : data.operations()) {
            if (seen.add(fingerprint(op)) || allowDuplicates) additions.add(op);
        }
        int skipped = data.operations().size() - additions.size();
        if (additions.isEmpty()) return new ImportResponse(0, skipped, null);

        Long savedTo = backup.snapshot(userId, "antes de importar la cartera", true);
        for (OperationRequest op : additions) {
            Operation o = new Operation();
            o.setUserId(userId);
            PortfolioMapper.apply(o, op.withSource("excel"));
            operations.save(o);
        }
        Set<String> tickers = new HashSet<>();
        additions.forEach(op -> tickers.add(op.ticker()));
        for (InstrumentRequest i : data.instruments()) {
            if (!tickers.contains(i.ticker())) continue;
            Instrument cur = instruments.findByUserIdAndTicker(userId, i.ticker()).orElse(null);
            if (cur == null) {
                Instrument created = new Instrument(userId, i.ticker());
                PortfolioMapper.apply(created, i);
                instruments.save(created);
                continue;
            }
            if (!cur.getCurrency().equals(i.currency())
                    || (cur.getIsin() != null && i.isin() != null && !cur.getIsin().equals(i.isin()))) {
                throw ApiException.badRequest("La divisa o el ISIN de " + i.ticker() + " no coincide con el valor guardado.");
            }
            // Lo ya guardado (cotización, nombre, notas…) manda sobre lo que trae el Excel.
            PortfolioMapper.apply(cur, new InstrumentRequest(i.ticker(), first(cur.getSymbol(), i.symbol()),
                    first(cur.getName(), i.name()), first(cur.getSector(), i.sector()), i.currency(),
                    first(cur.getIsin(), i.isin()), first(cur.getNotes(), i.notes())));
        }
        tickers.forEach(t -> ensureInstrument(userId, t));
        assertValid(userId);
        return new ImportResponse(additions.size(), skipped, savedTo);
    }

    /** Huella para no importar dos veces el mismo movimiento (no cuentan el origen, las notas ni la revisión). */
    static String fingerprint(OperationRequest o) {
        return String.join("|", o.date(), o.ticker().toUpperCase(), o.type().code(), n(o.shares()), n(o.price()),
                n(o.amountEur()), n(o.fees()), n(o.fxRate()), n(zero(o.withholdingEs())), n(zero(o.withholdingForeign())),
                n(o.splitRatio()), normalizeText(o.broker()), String.valueOf(o.transferRef()));
    }

    // ------------------------------------------------------------------------------------------------------------

    private void assertValid(UUID userId) {
        PortfolioService.assertValid(operations.findAllOrdered(userId), instruments.findByUserIdOrderByTicker(userId));
    }

    /**
     * Cambiar la divisa de un valor descuadraría los precios ya apuntados en la divisa anterior. Sí se permite
     * mientras ninguna otra operación tenga precio (vincular la cotización más tarde).
     */
    private void assertCurrencyUnchanged(UUID userId, String ticker, String currency, Long exceptId) {
        if (currency == null) return;
        Instrument current = instruments.findByUserIdAndTicker(userId, ticker.toUpperCase()).orElse(null);
        if (current == null || current.getCurrency().equals(currency)) return;
        boolean used = operations.findAllOrdered(userId).stream().anyMatch(o -> !Objects.equals(o.getId(), exceptId)
                && o.getTicker().equalsIgnoreCase(ticker) && o.getPrice() != null);
        if (used) {
            throw ApiException.badRequest(ticker + " ya tiene operaciones en " + current.getCurrency()
                    + ": no se puede cambiar su divisa.");
        }
    }

    private JsonNode instrumentPatch(JsonNode body) {
        JsonNode node = body.get("instrument");
        if (node == null || node.isNull()) return null;
        if (!node.isObject()) throw ApiException.badRequest("instrument: debe ser un objeto");
        return node;
    }

    private static String currencyIn(JsonNode patch) {
        if (patch == null || !patch.hasNonNull("currency")) return null;
        return patch.get("currency").asString().trim().toUpperCase();
    }

    /** Crea el valor si es nuevo y, si llega, fusiona encima el valor que acompaña a la operación. */
    private void saveInstrument(UUID userId, String ticker, JsonNode patch) {
        Instrument instrument = ensureInstrument(userId, ticker);
        if (patch == null) return;
        ObjectNode merged = patches.tree(InstrumentResponse.of(instrument).toRequest());
        JsonPatches.mergeShallow(merged, patch);
        merged.put("ticker", ticker);
        PortfolioMapper.apply(instrument, patches.convert(merged, InstrumentRequest.class, "instrument"));
    }

    private Instrument ensureInstrument(UUID userId, String ticker) {
        return instruments.findByUserIdAndTicker(userId, ticker)
                .orElseGet(() -> instruments.save(new Instrument(userId, ticker)));
    }

    private static String first(String a, String b) {
        return a != null ? a : b;
    }

    private static Double zero(Double v) {
        return v == null ? 0 : v;
    }

    private static String n(Double v) {
        if (v == null) return "null";
        return new BigDecimal(v).round(TWELVE).stripTrailingZeros().toPlainString();
    }

    private static String normalizeText(String v) {
        String s = Normalizer.normalize(v == null ? "" : v.trim(), Normalizer.Form.NFD);
        return s.replaceAll("\\p{M}", "").toLowerCase().replaceAll("[_\\s.-]+", " ");
    }
}
