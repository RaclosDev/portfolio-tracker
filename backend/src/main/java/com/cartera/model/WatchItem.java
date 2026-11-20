package com.cartera.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Valor vigilado dentro de una lista: niveles de compra, orden en el bróker y avisos. */
@Entity
@Table(name = "watch_items")
@Getter
@Setter
@NoArgsConstructor
public class WatchItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "list_id")
    private WatchList list;

    /** Símbolo de cotización (Yahoo), en mayúsculas. */
    @Column(nullable = false, length = 32)
    private String symbol;

    /** Ticker que se enseña; si falta, se saca del símbolo. */
    private String ticker;
    private String isin;
    private String name;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false, columnDefinition = "double precision[]")
    private List<Double> buyPrices = new ArrayList<>();

    private Double brokerTarget;
    private String brokerName;
    private Double investAmount;
    private Integer sharesOverride;

    @Column(nullable = false)
    private boolean orderActive;
    private Double orderPrice;
    private LocalDate orderUntil;

    private String notes;

    /** Avisos silenciados hasta esta fecha (incluida). */
    private LocalDate mutedUntil;
    /** Avisos silenciados sin fecha de fin. */
    @Column(nullable = false)
    private boolean mutedForever;

    @Column(nullable = false)
    private int position;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();
}
