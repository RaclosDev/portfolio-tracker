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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/** Copia completa de los datos de un usuario guardada en la base de datos (antes de importar, a diario…). */
@Entity
@Table(name = "snapshots")
@Getter
@Setter
@NoArgsConstructor
public class Snapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false, length = 40)
    private String reason;

    /** La copia en el formato de exportación ({@code GET /api/backup}). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String data;

    public Snapshot(UUID userId, String reason, String data) {
        this.userId = userId;
        this.reason = reason;
        this.data = data;
    }
}
