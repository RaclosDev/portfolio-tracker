package com.cartera.repository;

import com.cartera.model.TouchedOrder;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

public interface TouchedOrderRepository extends JpaRepository<TouchedOrder, Long> {

    List<TouchedOrder> findByUserIdOrderByTouchedAtAscIdAsc(UUID userId);


    /** Olvida las que ya no corresponden a una orden activa a ese precio (orden quitada o cambiada). */
    @Transactional
    @Modifying
    @Query(value = """
            DELETE FROM touched_orders t WHERE t.user_id = :userId AND NOT EXISTS
                (SELECT 1 FROM watch_items i WHERE i.id = t.item_id AND i.order_active AND i.order_price = t.order_price)
            """, nativeQuery = true)
    int forgetStale(UUID userId);

    @Transactional
    @Modifying
    @Query("update TouchedOrder t set t.dismissed = true where t.userId = :userId and t.itemId = :itemId")
    int dismiss(UUID userId, Long itemId);
}
