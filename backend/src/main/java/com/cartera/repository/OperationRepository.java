package com.cartera.repository;

import com.cartera.model.Operation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OperationRepository extends JpaRepository<Operation, Long> {

    @Query("select o from Operation o where o.userId = :userId order by o.date, o.dayOrder asc nulls last, o.id")
    List<Operation> findAllOrdered(@Param("userId") UUID userId);

    Optional<Operation> findByIdAndUserId(Long id, UUID userId);

    long countByUserId(UUID userId);

    @Modifying
    @Query("update Operation o set o.broker = :broker, o.needsReview = :needsReview, o.updatedAt = :now "
            + "where o.userId = :userId and o.id in :ids")
    int setBroker(@Param("userId") UUID userId, @Param("ids") Collection<Long> ids, @Param("broker") String broker,
                  @Param("needsReview") boolean needsReview, @Param("now") Instant now);

    @Modifying
    @Query("delete from Operation o where o.userId = :userId")
    int deleteByUser(@Param("userId") UUID userId);

    /**
     * Cerrojo de la cartera del usuario hasta el final de la transacción: las altas, cambios e importaciones se
     * validan sobre el registro definitivo, sin que otra petición se cuele entre la lectura y el guardado.
     */
    @Query(value = "select pg_advisory_xact_lock(hashtext('cartera:' || cast(:userId as text)))", nativeQuery = true)
    Object lockPortfolio(@Param("userId") UUID userId);
}
