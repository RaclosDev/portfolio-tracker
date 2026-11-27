package com.cartera.repository;

import com.cartera.model.RefreshToken;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, Long> {

    /** Bloquea la fila: dos refrescos simultáneos del mismo token se ejecutan uno tras otro. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM RefreshToken t WHERE t.tokenHash = :hash")
    Optional<RefreshToken> findByTokenHashForUpdate(String hash);

    @Modifying
    @Query("DELETE FROM RefreshToken t WHERE t.familyId = :familyId")
    int deleteFamily(UUID familyId);

    /** Cierra todas las sesiones del usuario. */
    @Modifying
    @Query("DELETE FROM RefreshToken t WHERE t.userId = :userId")
    int deleteAllOf(UUID userId);

    @Modifying
    @Query("DELETE FROM RefreshToken t WHERE t.expiresAt <= :now OR t.rotatedAt < :rotatedBefore")
    int deleteStale(Instant now, Instant rotatedBefore);
}
