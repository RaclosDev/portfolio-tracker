package com.cartera.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** Estado de la tarea de avisos de un usuario: qué se ha avisado ya y cuándo fue cada cosa. */
@Entity
@Table(name = "alert_state")
@Getter
@Setter
@NoArgsConstructor
public class AlertState {

    @Id
    private UUID userId;

    /** Último estado visto de cada nivel y cuándo se avisó de cada cosa ({@code AlertRules.Memory}). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String memory = "{}";

    private LocalDate lastSummaryOn;
    private LocalDate lastBackupOn;
    private Instant lastCheckedAt;

    public AlertState(UUID userId) {
        this.userId = userId;
    }
}
