-- Índices que faltaban en V1 (auditoría): las consultas por usuario de estas tablas recorrían la tabla entera,
-- y el historial de avisos se lee y se recorta por id, no por fecha.
CREATE INDEX touched_orders_user ON touched_orders(user_id, touched_at, id);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id, created_at);
DROP INDEX alert_history_user;
CREATE INDEX alert_history_user ON alert_history(user_id, id DESC);
