package com.cartera.repository;

import com.cartera.model.Instrument;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface InstrumentRepository extends JpaRepository<Instrument, Long> {

    List<Instrument> findByUserIdOrderByTicker(UUID userId);

    long countByUserId(UUID userId);

    Optional<Instrument> findByUserIdAndTicker(UUID userId, String ticker);

    /** Rellena el sector o el nombre si aún no los tiene: nunca pisa lo escrito a mano. */
    @Transactional
    @Modifying
    @Query("update Instrument i set i.sector = coalesce(i.sector, :sector), i.name = coalesce(i.name, :name), "
            + "i.updatedAt = :now where i.userId = :userId and i.ticker = :ticker")
    int fillProfile(@Param("userId") UUID userId, @Param("ticker") String ticker, @Param("sector") String sector,
                    @Param("name") String name, @Param("now") Instant now);

    @Modifying
    @Query("delete from Instrument i where i.userId = :userId")
    int deleteByUser(@Param("userId") UUID userId);
}
