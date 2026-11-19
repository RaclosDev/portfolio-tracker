/**
 * La app es para un inversor en España: «hoy», las horas de silencio, el resumen diario y los fines de
 * semana se cuentan en hora de Madrid aunque el servidor (Render, Docker) corra en UTC.
 * Se importa antes que nada para que todas las fechas locales lo usen. TZ en el entorno manda.
 */
process.env.TZ ||= 'Europe/Madrid';
