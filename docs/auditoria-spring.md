# Auditoría del backend Spring (rama `spring`)

Fecha: 20-11-2026 · Alcance: `backend/` (Spring Boot 4.1.2, Java 21), migraciones Flyway, despliegue (Dockerfile, render.yaml, CI) y paridad con la app TS de `main`.
Estado: cada hallazgo se ha comprobado y se han corregido los confirmados. El resultado está en la sección siguiente; el resto del documento es la auditoría original.

## Resumen

| Gravedad | Nº | Lo más urgente |
|---|---|---|
| Crítico | 2 | Transacción de solo lectura alrededor de llamadas a mercado; restaurar copia llama a la red por cada valor dentro de la transacción |
| Alto | 5 | BCrypt >72 bytes da 500, rate limit saltable con `X-Forwarded-For`, Render free duerme el scheduler, SSRF en Web Push, cobertura de tests mínima |
| Medio | 9 | Conexiones retenidas en HTTP, sin manejo global de `DataIntegrityViolationException`, N+1 en varios sitios, índices que faltan, migración V2 frágil… |
| Bajo | 6 | Detalles de rendimiento y limpieza |

Paridad de rutas: **todas las rutas de `apps/server/src/routes.ts` existen en Spring** (más auth, `/api/users/me`, órdenes tocadas y mercado público). No falta ninguna funcionalidad de API.

## Resultado de la verificación y arreglos

| # | Veredicto | Cómo se comprobó | Arreglo |
|---|---|---|---|
| C1 | **Confirmado** | Test `marketCacheSavesInsideReadOnlyTransaction`: fallaba con *cannot execute INSERT in a read-only transaction* y luego *current transaction is aborted* | `MarketCacheRepository` lee y escribe fuera de la transacción de quien llama (`NOT_SUPPORTED`); `WatchlistViewService.view` ya no es transaccional |
| C2 | **Confirmado en restaurar**; **falso en importar lista** | Lectura: `restore → create → isinOf` (HTTP) dentro de la transacción. `importRows` no busca ISIN | `WatchItemService.insert` sin red; los ISIN se completan tras el commit en un hilo virtual (`fillIsinsAfterCommit`). Test `restoreLooksUpIsinsAfterCommit` |
| A1 | **Confirmado** | Test `longPasswordsAreRejectedCleanly`: daba 500 | Registro: máximo 72 bytes UTF-8 con mensaje claro (y `maxLength` en el formulario). Login: más de 72 bytes es contraseña incorrecta |
| A2 | **Confirmado** | `ForwardedHeaderFilter` toma el valor más a la izquierda de `X-Forwarded-For`, que pone el cliente | IP del salto añadido por el proxy de confianza (`app.rate-limiting.trusted-proxy-hops`, 1 por defecto), límite por correo en el login (10 fallos / 15 min → 429) y límite global de 120 a 600/min. Tests `RateLimitingFilterTest` y `loginIsLimitedPerEmail` |
| A3 | **Confirmado** | No había ping externo ni monitor en Sentry | `.github/workflows/despertar.yml`: ping cada 10 min a `/actuator/health/liveness` |
| A4 | **Confirmado** | El patrón solo exigía `https://` | Lista de servicios push permitidos (sin puerto, sin usuario), al suscribir y al enviar. Test `WebPushEndpointTest`. La reasignación de un endpoint existente se mantiene: es el mismo navegador al cambiar de cuenta y la URL es secreta |
| A5 | **Confirmado** | 12 tests | 13 tests nuevos, uno por arreglo (ver arriba y abajo). Portar `cartera.reference.test.ts` queda pendiente: es un trabajo aparte |
| M1 | **Confirmado** en alta y edición de valores; **falso** para `snapshot` | `create/update` buscaban el ISIN con la transacción abierta. `snapshot` solo lee BD y tiene que ir dentro del bloqueo | ISIN fuera de la transacción: guarda, busca y rellena con `fillIsin` condicional (`isin is null and symbol = …`) |
| M2 | **Confirmado** | No había manejador | `DataIntegrityViolationException` y `OptimisticLockingFailureException` → 409. Alta con Google: `saveAndFlush` para que el choque salga dentro. Test `integrityViolationsAreConflicts` |
| M3 | **Confirmado** (export, órdenes tocadas, scheduler, divisa); **no es fallo** en `AlertService.rows` | Lectura del código. En `rows`, las cotizaciones repetidas las sirve la caché en memoria de `MarketService` con deduplicación en vuelo | Export: una consulta `findAllByUser`. Órdenes tocadas: un set por vuelta. Scheduler: estados en una consulta. Divisa: `existsPriced`. El scheduler sigue en serie a propósito: en paralelo agotaría el pool de 5 conexiones |
| M4 | **Confirmado** | `findById` por petición | Caché Caffeine de 30 s del usuario autenticado |
| M5 | **Confirmado** | V1 sin índice en `touched_orders(user_id)` ni `push_subscriptions(user_id)`; historial leído y recortado por `id` con índice por `at` | `V3__missing_indexes.sql` |
| M6 | **Falso** | La app TS también guarda `DOUBLE PRECISION`; el #94 redondea a céntimos al calcular, y eso ya está en `Money.cents`. `forgetStale` compara el mismo `double` copiado de la columna, así que la igualdad es exacta | Ninguno |
| M7 | **Parcialmente confirmado** | Los límites de V1 coinciden con los zod de la app TS, pero los nombres que rellenaba el servidor y los visitados no pasaban por zod; `chart_drawings` podía chocar; `at` nulo rompía; el `item_id` viejo podía apuntar a otro valor. V2 aún no se ha aplicado en producción (`backend/` no está en `main`), así que se puede editar | V2: textos recortados al tamaño de columna, `ON CONFLICT` en dibujos, `at` nulo → `now()`, órdenes sin precio fuera, aviso de valor borrado → `item_id` 0 |
| M8 | **Confirmado** | Tomcat solo limita formularios | `BodySizeLimitFilter`: 12 MB para cuerpos no multipart (413 con `Content-Length`, corte al leer si es chunked). Test `hugeBodiesAreRejected` |
| M9 | **Falso** | El enlace ya da 409 si otra cuenta tiene ese `sub`; volver a enlazar la tuya es intencionado. Solo quedaba la carrera, cubierta por M2 | Ninguno aparte de M2 |
| B1 | **Confirmado** | `read` mezclaba y validaba el JSON en cada llamada | Caché de ajustes ya leídos, con el JSON guardado como clave (no hace falta invalidar) |
| B2 | **No es fallo** | Como mucho 201 filas, y la respuesta devuelve la lista entera igualmente | Ninguno |
| B3 | **Confirmado** | bcrypt en cada arranque aunque no se use | Solo se codifica si hace falta |
| B4 | **Confirmado** | `clear()` borraba todo y repetía cientos de peticiones | Caffeine con expiración de un día |
| B5 | **Confirmado** | Cada lote esperaba al más lento | `Semaphore(2)`: en cuanto acaba una, empieza otra |
| B6 | **Confirmado, se documenta** | Al restaurar cambian los ids y la memoria de avisos queda huérfana; las órdenes tocadas se borran en cascada | Documentado en `BackupService.restore`: tras restaurar puede repetirse algún aviso ya enviado |

**Por comprobar en producción:** que Render añade un solo salto a `X-Forwarded-For`. Si hay Cloudflare u otro proxy delante, `APP_RATE_LIMITING_TRUSTED_PROXY_HOPS` tiene que ser 2.

---

## Crítico

### C1. `WatchlistViewService.view` es `@Transactional(readOnly = true)` y dentro llama a mercado
`service/watchlist/WatchlistViewService.java` — Dentro de la transacción se piden cotizaciones, objetivos y divisas. `MarketCacheRepository` usa `JdbcTemplate`, que se une a la conexión de la transacción JPA, marcada como solo lectura:
- El `INSERT … ON CONFLICT` de `market_cache` falla con *cannot execute INSERT in a read-only transaction*. El `catch (DataAccessException)` lo oculta, pero en PostgreSQL la transacción queda abortada y las lecturas de respaldo (`cache.find`, el «último precio conocido») fallan también. Desde la vista de lista, la caché persistente no se guarda nunca, y el respaldo con datos viejos tampoco funciona cuando Yahoo falla.
- La conexión queda retenida mientras duran las peticiones HTTP, y `getTargets` lanza 4 hilos virtuales que piden más conexiones. Con `maximum-pool-size=5`, dos o tres usuarios cargando listas a la vez agotan el pool (timeouts de 30 s).
- `AlertService.rows()` llama a `view` por cada lista y cada minuto, así que el scheduler sufre el mismo problema.

**Arreglo:** quitar `@Transactional` de `view` (leer filas con una consulta corta y llamar a mercado fuera), o mover la escritura de caché a `REQUIRES_NEW` o a un hilo aparte. Añadir un test de integración que compruebe que `market_cache` tiene filas después de `GET /api/lists/{id}/watchlist`.
*Nota:* lo deduzco del código, no lo he reproducido. El test de arriba lo confirma o lo descarta.

### C2. Restaurar una copia llama a la red por cada valor, dentro de una transacción con bloqueos
`BackupService.restore` → `itemService.create` → `withIsin()` → `isins.isinOf(symbol)` (HTTP) para cada valor sin ISIN. Todo pasa dentro de una transacción que tiene el advisory lock de la cartera y `lockAllByUser`. Con 200 valores son 200 peticiones en serie: la petición puede tardar minutos, retiene una de las 5 conexiones, bloquea cualquier alta del usuario y puede acabar en timeout del proxy de Render, con rollback de todo. Pasa lo mismo con `POST /api/lists/{id}/import`.
**Arreglo:** en restore e import, no resolver el ISIN (`create(..., resolveIsin=false)`) y completarlo después en segundo plano, igual que `fillProfilesInBackground`.

## Alto

### A1. Contraseñas de más de 72 bytes dan 500
`PasswordAuthService` valida `@Size(max = 200)`, pero `BCryptPasswordEncoder` en Spring Security 7 lanza `IllegalArgumentException` por encima de 72 bytes, también en el camino del `dummyHash` del login. Además, 72 *bytes* no son 72 caracteres cuando hay tildes o emojis.
**Arreglo:** limitar a 72 bytes UTF-8 en el registro, con un mensaje claro, y en el login tratar >72 como credenciales incorrectas. Test con una contraseña de 100 caracteres.

### A2. El rate limiting se salta con `X-Forwarded-For`
`RateLimitingFilter` usa `getRemoteAddr()` con `server.forward-headers-strategy=framework`. El valor sale del `X-Forwarded-For` que manda el cliente (el más a la izquierda), así que cada petición puede inventarse una IP: fuerza bruta de login ilimitada. Además, el límite global de 120/min lo puede agotar un solo atacante y deja fuera a todos (DoS).
**Arreglo:** coger la IP que añade el proxy de Render (la última de la cabecera) o configurar `RemoteIpValve` con los proxies de confianza. Limitar también por email en el login. Quitar el límite global o subirlo mucho. ascension-tracker ya usa Bucket4j.

### A3. En Render free, el scheduler no corre si nadie usa la app
`render.yaml` usa `plan: free`: el servicio se duerme tras 15 min sin tráfico. Mientras duerme no hay avisos (`AlertScheduler`), ni copia diaria, ni purga de sesiones (`@Scheduled 04:15`). Las notificaciones push dejan de llegar justo cuando la web está cerrada, que es para lo que existen.
**Arreglo:** un ping externo cada 10 min (cron-job.org o GitHub Actions) a `/api/health`, o un plan de pago. Comprobar cómo lo resolvía la app TS.

### A4. SSRF en las suscripciones Web Push
`Subscription.endpoint` solo exige `https://\S+`. Cualquier usuario puede registrar `https://169.254.169.254/…` o un host interno, y el servidor le hará POST en cada aviso y en `/api/push/test`. Además, `subscribe` reasigna un endpoint que ya existe al usuario actual, aunque eso exige conocer la URL y el riesgo es bajo.
**Arreglo:** lista de hosts permitidos (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`) y rechazar IPs literales.

### A5. Cobertura de tests mínima
Hay 12 tests en 4 clases. No hay tests de `Ledger`/FIFO, `PortfolioHistoryCalculator`, `AlertRules`, `BackupService` (restore e import), `OperationService` (validación con bloqueo) ni de las migraciones con datos antiguos. La app TS tenía `api.test.ts` y `cartera.reference.test.ts`, y porrApp (193) y ascension-tracker (103) están muy por encima.
**Arreglo:** portar primero `cartera.reference.test.ts` (cálculos de la Renta) y un test de V2 con un dump antiguo.

## Medio

1. **Llamadas HTTP dentro de transacciones de escritura**: `WatchItemService.create/update` (ISIN) y `OperationService.importOperations` → `backup.snapshot` (sin red, pero con un export pesado dentro del lock). Sacar la red de la transacción.
2. **Sin manejo global de `DataIntegrityViolationException` ni de `OptimisticLockingFailureException`**: dos peticiones a la vez (crear la misma lista o valor, enlazar Google con un `sub` repetido) devuelven 500. Las otras tres apps Spring sí lo manejan. Mapear a 409 en `GlobalExceptionHandler`.
3. **N+1**
   - `BackupService.export`: una consulta de valores por lista. Debería ser una sola consulta `findByUserId…` agrupada en memoria. Se ejecuta en cada snapshot: restore, import y la copia diaria.
   - `AlertService.recordTouched`: `existsByItemIdAndOrderPrice` por cada fila con orden activa, cada minuto. Mejor cargar el set de una vez.
   - `AlertScheduler.run`: `users.findAll()` y, por usuario, `settings.get` y `states.findById`. Va en serie, así que un usuario lento retrasa a todos. Con pocos usuarios no importa, pero conviene una sola consulta de los que toca revisar.
   - `AlertService.rows`: `watchlist.view` por lista, y repite cotizaciones si un valor está en varias listas (la caché lo atenúa).
   - `OperationService.assertCurrencyUnchanged` carga **todas** las operaciones solo para un `anyMatch`. Usar `existsBy…`.
4. **`JwtAuthFilter` consulta la BD en cada petición** (`findById`): con el pool de 5 y la vista que hace muchas llamadas, suma. Cachear el usuario 30–60 s con Caffeine o fiarse de los claims.
5. **Índices que faltan** (V1): `touched_orders(user_id)`, `push_subscriptions(user_id)`. Además, `alert_history` tiene índice `(user_id, at DESC)` pero el recorte ordena por `id`.
6. **`DOUBLE PRECISION` para dinero**: la app TS pasó a céntimos en #94. Aquí importes, precios y comisiones son `double`. La huella de importación lo compensa redondeando a 12 cifras, y `TouchedOrderRepository.forgetStale` compara `order_price` con igualdad exacta de `double`, que es frágil. Valorar `NUMERIC(18,6)` o `BigDecimal`, al menos en `operations`.
7. **Migración V2 frágil**: los `VARCHAR` (nombre 120, lista 60, símbolo 32) hacen fallar *toda* la migración si un dato antiguo es más largo. `chart_drawings` con `upper(symbol)` sin `ON CONFLICT` choca si hay variantes de mayúsculas. `(o->>'at')::timestamptz NOT NULL` falla con nulos. `alert_history.item_id` conserva ids que pueden chocar con los nuevos. Probarla contra una copia real de Neon antes de desplegar.
8. **Cuerpos JSON sin límite de tamaño**: `restore`, `import` y `drawings` aceptan `JsonNode` sin tope. Los límites de multipart no se aplican a JSON. Poner un tope en el filtro o en Tomcat (`max-swallow-size` y validar `Content-Length`).
9. **`GoogleAuthService.link`** sobrescribe sin avisar un `googleSubject` que ya existe. Si otra cuenta tiene ese `sub`, la restricción única da 500 (ver punto 2).

## Bajo

- `SettingsService.read` deserializa el JSON completo en cada llamada, y se llama muchas veces por petición y por minuto en el scheduler. Cachearlo.
- `VisitedService` carga todos los visitados en cada visita para recortar. Bastaría un `DELETE … WHERE id NOT IN (SELECT … LIMIT n)`.
- `DataInitializer` vuelve a codificar la contraseña del usuario demo en cada arranque.
- `PortfolioService.profileTried` hace `clear()` al llegar a 5000. Un `Caffeine` con expiración sería más limpio.
- `PortfolioService.history` pide históricos de 2 en 2 con `subList` y espera a cada lote. Con un `Semaphore(2)` iría más fluido.
- Restaurar una copia cambia los ids de los valores, así que la memoria de avisos (`AlertState.memory`) y las órdenes tocadas quedan huérfanas y se pierde el estado «ya avisado». Aceptable, pero conviene documentarlo.

## Lo que está bien

- Bloqueo de cartera con `pg_advisory_xact_lock` y validación del registro completo dentro de la transacción.
- Refresh token rotatorio con hash, revocación por familia y gracia de 30 s. Cookie `__Secure-`, `SameSite=Strict` y ruta acotada.
- `CsrfOriginFilter` y CSP estricta. Ojo: si el frontend carga algún widget externo, como TradingView, hay que añadirlo a `script-src`/`frame-src`.
- `open-in-view=false`, `ddl-auto=validate`, `default_batch_fetch_size=50` y `findOwned` con `join fetch`.
- Scrypt antiguo con semáforo para no reventar la memoria y migración progresiva a bcrypt.
- Deduplicación de peticiones en vuelo en `MarketService`.

## Orden recomendado

1. C1 y C2 (rendimiento y fiabilidad en producción).
2. A1, A2 y A4 (seguridad, cambios pequeños).
3. A3 (ping externo, 5 minutos).
4. Medio 2, 5 y 7 antes de migrar los datos reales.
5. A5 de forma continua: un test por cada arreglo.
