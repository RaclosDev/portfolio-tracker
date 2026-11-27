-- Versión de los dibujos de cada valor: el PUT sustituye la lista entera y, con la versión, un cliente que
-- partía de una lista vieja o vacía no puede pisar lo que otro dispositivo ha guardado después.
ALTER TABLE chart_drawings ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
