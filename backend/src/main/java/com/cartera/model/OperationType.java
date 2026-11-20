package com.cartera.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.util.Arrays;
import java.util.Set;

/**
 * Tipos de operación del registro de la cartera.
 * <ul>
 *   <li>buy / sell: compra y venta de acciones.</li>
 *   <li>transfer_out / transfer_in: pareja de traspaso entre fondos, con coste y antigüedad conservados.</li>
 *   <li>dividend: dividendo (en bruto, con sus retenciones aparte).</li>
 *   <li>scrip: acciones liberadas: suman acciones sin coste.</li>
 *   <li>rights_sale: venta de derechos de suscripción.</li>
 *   <li>issue_premium: devolución de prima de emisión.</li>
 *   <li>attendance_premium: prima de asistencia a la junta.</li>
 *   <li>split: desdoblamiento o contrasplit (ratio = acciones nuevas por cada antigua).</li>
 * </ul>
 */
public enum OperationType {
    BUY("buy", 1),
    SELL("sell", 3),
    TRANSFER_OUT("transfer_out", 4),
    TRANSFER_IN("transfer_in", 5),
    DIVIDEND("dividend", 2),
    SCRIP("scrip", 1),
    RIGHTS_SALE("rights_sale", 2),
    ISSUE_PREMIUM("issue_premium", 2),
    ATTENDANCE_PREMIUM("attendance_premium", 2),
    SPLIT("split", 0);

    /** Cobros (rendimientos): llevan importe bruto y retenciones. */
    public static final Set<OperationType> INCOME = Set.of(DIVIDEND, RIGHTS_SALE, ISSUE_PREMIUM, ATTENDANCE_PREMIUM);

    private final String code;
    /** Orden de proceso dentro del mismo día cuando no hay «orden del día»: compras antes que ventas. */
    private final int rank;

    OperationType(String code, int rank) {
        this.code = code;
        this.rank = rank;
    }

    @JsonValue
    public String code() {
        return code;
    }

    public int rank() {
        return rank;
    }

    public boolean isIncome() {
        return INCOME.contains(this);
    }

    /** Suma acciones a la posición. */
    public boolean addsShares() {
        return this == BUY || this == SCRIP || this == TRANSFER_IN;
    }

    @JsonCreator
    public static OperationType of(String code) {
        return Arrays.stream(values()).filter(t -> t.code.equals(code)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Tipo de operación desconocido: " + code));
    }

    @Converter(autoApply = true)
    public static class JpaConverter implements AttributeConverter<OperationType, String> {
        @Override
        public String convertToDatabaseColumn(OperationType type) {
            return type == null ? null : type.code;
        }

        @Override
        public OperationType convertToEntityAttribute(String code) {
            return code == null ? null : of(code);
        }
    }
}
