package com.cartera.repository;

import com.cartera.model.ChartDrawings;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChartDrawingsRepository extends JpaRepository<ChartDrawings, ChartDrawings.Key> {
}
