package com.cartera.repository;

import com.cartera.model.WatchItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WatchItemRepository extends JpaRepository<WatchItem, Long> {

    @Query("select i from WatchItem i join fetch i.list l where i.id = :id and l.userId = :userId")
    Optional<WatchItem> findOwned(Long id, UUID userId);

    List<WatchItem> findByListIdOrderByPositionAscIdAsc(Long listId);

    @Query("select coalesce(max(i.position), 0) from WatchItem i where i.list.id = :listId")
    int maxPosition(Long listId);

    @Query("select count(i) from WatchItem i where i.list.id = :listId")
    long countByList(Long listId);
}
