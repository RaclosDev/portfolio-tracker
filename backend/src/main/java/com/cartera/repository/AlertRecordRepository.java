package com.cartera.repository;

import com.cartera.model.AlertRecord;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.UUID;

public interface AlertRecordRepository extends JpaRepository<AlertRecord, Long> {

    List<AlertRecord> findByUserIdOrderByIdDesc(UUID userId, Limit limit);

    /** Deja solo los {@code keep} avisos más recientes del usuario. */
    @Modifying
    @Query(value = """
            DELETE FROM alert_history WHERE user_id = :userId AND id NOT IN
                (SELECT id FROM alert_history WHERE user_id = :userId ORDER BY id DESC LIMIT :keep)
            """, nativeQuery = true)
    int trim(UUID userId, int keep);
}
