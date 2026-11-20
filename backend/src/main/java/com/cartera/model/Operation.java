package com.cartera.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Un movimiento del registro de la cartera.
 * <p>Importes: {@code amountEur} es, en una compra, el coste total en euros con comisiones; en una venta, lo
 * recibido ya sin comisiones; en los cobros, el importe bruto; en scrip y split, 0. {@code fees} va en la divisa
 * del valor y {@code fxRate} son unidades de esa divisa por 1 € el día de la operación.
 */
@Entity
@Table(name = "operations")
@Getter
@Setter
@NoArgsConstructor
public class Operation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false)
    private LocalDate date;

    @Column(nullable = false, length = 32)
    private String ticker;

    @Column(nullable = false, length = 20)
    private OperationType type;

    private Double shares;
    private Double price;

    @Column(nullable = false)
    private double fees;

    @Column(nullable = false)
    private double fxRate = 1;

    @Column(nullable = false)
    private double amountEur;

    private Double withholdingEs;
    private Double withholdingForeign;
    private Double splitRatio;
    private String broker;
    private String notes;

    @Column(nullable = false)
    private boolean needsReview;

    /** manual o excel. */
    @Column(nullable = false, length = 10)
    private String source = "manual";

    /** Nº de la fila en el Excel de origen. */
    private Integer sourceRef;
    /** Scrip: Nº ({@code sourceRef}) de la compra cuyo lote recibe las acciones. */
    private Integer lotRef;
    /** Orden dentro del día (1, 2, 3…). */
    private Integer dayOrder;
    /** Referencia compartida por las dos patas de un traspaso. */
    private String transferRef;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();
}
