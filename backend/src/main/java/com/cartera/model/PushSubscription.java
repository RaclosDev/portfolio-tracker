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

/** Un dispositivo (navegador) que recibe notificaciones Web Push. */
@Entity
@Table(name = "push_subscriptions")
@Getter
@Setter
@NoArgsConstructor
public class PushSubscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private UUID userId;

    @Column(nullable = false, unique = true)
    private String endpoint;

    @Column(nullable = false)
    private String p256dh;

    @Column(nullable = false)
    private String auth;

    @Column(length = 80)
    private String label;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    private Instant lastOkAt;
}
