package com.cartera.repository;

import com.cartera.model.AlertState;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface AlertStateRepository extends JpaRepository<AlertState, UUID> {
}
