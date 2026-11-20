package com.cartera.repository;

import com.cartera.model.PushSubscription;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PushSubscriptionRepository extends JpaRepository<PushSubscription, Long> {

    List<PushSubscription> findByUserIdOrderByCreatedAtAsc(UUID userId);

    Optional<PushSubscription> findByEndpoint(String endpoint);

    @Modifying
    @Query("delete from PushSubscription p where p.userId = :userId and p.endpoint = :endpoint")
    int deleteByEndpoint(UUID userId, String endpoint);

    @Modifying
    @Query("delete from PushSubscription p where p.userId = :userId and p.id = :id")
    int deleteOwned(UUID userId, Long id);

    @Transactional
    @Modifying
    @Query("update PushSubscription p set p.lastOkAt = :at where p.id = :id")
    void markOk(Long id, Instant at);
}
