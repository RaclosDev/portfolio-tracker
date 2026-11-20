package com.cartera.repository;

import com.cartera.model.Snapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SnapshotRepository extends JpaRepository<Snapshot, Long> {

    /** Resumen de una copia sin traer sus datos: cuántos valores vigilados y operaciones lleva. */
    interface Summary {
        Long getId();

        Instant getCreatedAt();

        String getReason();

        int getItems();

        int getOperations();
    }

    @Query(value = """
            select id, created_at as createdAt, reason,
                   (select coalesce(sum(jsonb_array_length(l->'items')), 0)::int
                      from jsonb_array_elements(data->'lists') l) as items,
                   coalesce(jsonb_array_length(data->'portfolio'->'operations'), 0)::int as operations
            from {h-schema}snapshots where user_id = :userId order by created_at desc, id desc""", nativeQuery = true)
    List<Summary> summaries(@Param("userId") UUID userId);

    Optional<Snapshot> findByIdAndUserId(Long id, UUID userId);

    /** Borra las copias más antiguas del usuario y deja las {@code keep} más recientes. */
    @Modifying
    @Query(value = """
            delete from {h-schema}snapshots where user_id = :userId and id not in (
                select id from {h-schema}snapshots where user_id = :userId order by created_at desc, id desc limit :keep)""",
            nativeQuery = true)
    int prune(@Param("userId") UUID userId, @Param("keep") int keep);
}
