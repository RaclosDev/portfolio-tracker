package com.cartera.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/** Un valor abierto desde el buscador de la cabecera (lista «Visitados»). */
@Entity
@Table(name = "visited_symbols")
@IdClass(VisitedSymbol.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class VisitedSymbol {

    public record Key(UUID userId, String symbol) implements Serializable {
        public Key() {
            this(null, null);
        }
    }

    @Id
    private UUID userId;

    @Id
    private String symbol;

    @Column(nullable = false)
    private String name;

    private String exchange;
    private String type;
    private String isin;

    @Column(nullable = false)
    private Instant visitedAt;
}
