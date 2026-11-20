package com.cartera.repository;

import com.cartera.model.UserSettings;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;
import java.util.UUID;

public interface UserSettingsRepository extends JpaRepository<UserSettings, UUID> {

    /** Crea la fila vacía si no existe; así el bloqueo de después siempre tiene algo que bloquear. */
    @Modifying
    @Query(value = "INSERT INTO user_settings (user_id, data) VALUES (:userId, '{}'::jsonb) ON CONFLICT (user_id) DO NOTHING",
            nativeQuery = true)
    void ensureExists(UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from UserSettings s where s.userId = :userId")
    Optional<UserSettings> findForUpdate(UUID userId);
}
