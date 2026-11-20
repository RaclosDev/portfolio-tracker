package com.cartera.repository;

import com.cartera.model.VisitedSymbol;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface VisitedSymbolRepository extends JpaRepository<VisitedSymbol, VisitedSymbol.Key> {

    List<VisitedSymbol> findByUserIdOrderByVisitedAtDesc(UUID userId);
}
