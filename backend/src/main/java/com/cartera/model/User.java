package com.cartera.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/** Cuenta de usuario. Todos sus datos cuelgan de su id. */
@Entity
@Table(name = "users")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class User {

    @Id
    private UUID id;

    /** En minúsculas y sin espacios (lo exige también la base de datos). */
    @Column(nullable = false, unique = true)
    private String email;

    /** Hash de la contraseña con el prefijo de su algoritmo; null si solo entra con Google. */
    private String passwordHash;

    /** Claim «sub» de Google de la cuenta vinculada. */
    private String googleSubject;

    @Column(nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
