package com.cartera.repository;

import com.cartera.dto.ListResponse;
import com.cartera.model.WatchList;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WatchListRepository extends JpaRepository<WatchList, Long> {

    Optional<WatchList> findByIdAndUserId(Long id, UUID userId);

    @Query("""
            select new com.cartera.dto.ListResponse(l.id, l.name, count(i))
            from WatchList l left join WatchItem i on i.list = l
            where l.userId = :userId
            group by l.id, l.name, l.position
            order by l.position, l.id""")
    List<ListResponse> summaries(UUID userId);

    /** Bloquea todas las listas del usuario: dos borrados a la vez no pueden dejarle sin ninguna. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select l from WatchList l where l.userId = :userId")
    List<WatchList> lockAllByUser(UUID userId);

    @Query("select coalesce(max(l.position), 0) from WatchList l where l.userId = :userId")
    int maxPosition(UUID userId);

    /** Borra todas las listas del usuario (sus valores se van con ellas en la base de datos). */
    @Modifying
    @Query("delete from WatchList l where l.userId = :userId")
    int deleteByUser(UUID userId);
}
