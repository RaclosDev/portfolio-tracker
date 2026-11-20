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
import java.util.UUID;

/** Un aviso enviado (historial). */
@Entity
@Table(name = "alert_history")
@Getter
@Setter
@NoArgsConstructor
public class AlertRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, updatable = false)
    private Instant at = Instant.now();

    @Column(nullable = false, length = 20)
    private String kind;

    @Column(nullable = false)
    private Long itemId;

    @Column(nullable = false, length = 32)
    private String symbol;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String body;
}
