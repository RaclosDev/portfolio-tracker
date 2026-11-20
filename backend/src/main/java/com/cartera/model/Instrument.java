package com.cartera.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/** Un valor de la cartera: el ticker del registro y cómo se cotiza. */
@Entity
@Table(name = "instruments")
@Getter
@Setter
@NoArgsConstructor
public class Instrument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, length = 32)
    private String ticker;

    /** Símbolo de Yahoo Finance (TEF.MC, IBM…). Sin él no hay precio actual. */
    private String symbol;
    private String name;
    private String sector;

    @Column(nullable = false, length = 3)
    @JdbcTypeCode(SqlTypes.CHAR)
    private String currency = "EUR";

    private String isin;
    private String notes;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    public Instrument(UUID userId, String ticker) {
        this.userId = userId;
        this.ticker = ticker;
    }
}
