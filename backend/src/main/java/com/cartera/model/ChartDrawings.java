package com.cartera.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.io.Serializable;
import java.util.UUID;

/** Todos los dibujos del gráfico de velas de un valor, guardados juntos. */
@Entity
@Table(name = "chart_drawings")
@IdClass(ChartDrawings.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class ChartDrawings {

    public record Key(UUID userId, String symbol) implements Serializable {
        public Key() {
            this(null, null);
        }
    }

    @Id
    private UUID userId;

    @Id
    private String symbol;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String drawings;

    /** Sube con cada cambio: el cliente la devuelve en If-Match y, si ya no coincide, no se sobrescribe. */
    @Version
    @Column(nullable = false)
    private Long version;
}
