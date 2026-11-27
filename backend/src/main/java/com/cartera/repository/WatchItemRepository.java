package com.cartera.repository;

import com.cartera.model.WatchItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WatchItemRepository extends JpaRepository<WatchItem, Long> {

    @Query("select i from WatchItem i join fetch i.list l where i.id = :id and l.userId = :userId")
    Optional<WatchItem> findOwned(Long id, UUID userId);

    List<WatchItem> findByListIdOrderByPositionAscIdAsc(Long listId);

    /** Todos los valores de todas las listas del usuario en una consulta (para agruparlos por lista en memoria). */
    @Query("select i from WatchItem i where i.list.userId = :userId order by i.position, i.id")
    List<WatchItem> findAllByUser(UUID userId);

    @Query("select coalesce(max(i.position), 0) from WatchItem i where i.list.id = :listId")
    int maxPosition(Long listId);

    @Query("select count(i) from WatchItem i where i.list.userId = :userId")
    long countByUser(UUID userId);

    @Query("select count(i) from WatchItem i where i.list.id = :listId")
    long countByList(Long listId);

    /** Pone el ISIN encontrado después del alta, solo si nadie lo ha rellenado ni ha cambiado la cotización entretanto. */
    @Modifying
    @Query("update WatchItem i set i.isin = :isin where i.id = :id and i.isin is null and i.symbol = :symbol")
    int fillIsin(Long id, String symbol, String isin);
}
