# Informe: ¿por qué Node/TypeScript y no Spring Boot?

Fecha: 20/11/2026. Objetivo: comprobar, librería por librería y con datos, si la elección de Node.js + TypeScript para el servidor estaba justificada frente a Spring Boot (el stack del resto del portfolio).

## 1. Qué cambiaría y qué no

La web (React, Vite, TanStack Query, lightweight-charts, lectura/escritura de Excel, PWA) **sería igual con cualquier backend**. Solo cambiaría el servidor (`apps/server`, ~5.500 líneas) y qué se hace con `packages/shared` (~3.100 líneas).

Corrección a lo que dije antes: lightweight-charts y las librerías de Excel **no son argumento**, porque son del navegador y se usarían igual con Spring Boot.

## 2. Librería por librería del servidor

| Necesidad | Hoy (npm) | En Java / Spring | Veredicto |
|---|---|---|---|
| API HTTP | Fastify 5 | Spring Web (MVC o WebFlux) | Empate. Spring es más completo. |
| Validación | zod (el mismo esquema en web y API) | Bean Validation (`@Valid`) en el servidor; en la web habría que repetirla o generarla desde OpenAPI | Node gana: un solo esquema para los dos lados. |
| PostgreSQL | `pg` + SQL a mano + migraciones propias | JDBC/JPA + Flyway | Spring gana en herramientas. |
| BD local sin instalar nada | PGlite (Postgres compilado a WASM, dentro del proceso) | Zonky embedded-postgres (descarga binarios reales de Postgres) o Testcontainers (Docker) | Existe equivalente, algo más pesado. |
| Notificaciones Web Push | `web-push` | `nl.martijndwars:web-push` (webpush-java, VAPID; mantenimiento poco activo) o `interaso/webpush` (Kotlin, recomendada por el autor de un fork ya archivado) | Existe; la de Node está más mantenida. |
| Login con Google | google-auth-library | Spring Security OAuth2 Client | Spring gana: más completo de serie. |
| Cotizaciones Yahoo | yahoo-finance2 (mantenida, resuelve cookie + crumb) | `sstrickx/yahoofinance-api`, sin mantener desde hace años; habría que programar a mano el handshake cookie A1 → `/v1/test/getcrumb` → `/v7/finance/quote` | **Única diferencia real de librerías**: en Java habría que escribirlo (≈100-200 líneas). |
| Resto de fuentes (Borsa Italiana, Quefondos, onvista, justETF, FT, Financial Hub) | Código propio con `fetch` | Código propio con `HttpClient` + Jsoup | Empate: hoy ya son código nuestro. |

**Conclusión de librerías:** casi todo existe en Java. Solo falta un cliente de Yahoo mantenido, y eso se resuelve programando el acceso. **Las librerías no justifican la decisión.**

## 3. Lo que sí pesa

### 3.1 Código compartido entre web y servidor
`packages/shared` lo importan 56 archivos de la web y 26 del servidor. Contiene los esquemas, los tipos y los cálculos de dominio: lotes FIFO (`ledger.ts`), métricas y niveles (`calc.ts`), evaluación de avisos (`alerts.ts`), importación de Excel, fiscalidad y exposición.

Con Spring Boot hay tres caminos:
1. **Duplicar** los cálculos en Java y TypeScript. Es el que más riesgo tiene: el mismo número puede salir distinto en la pantalla y en el aviso del móvil.
2. **Mover todos los cálculos al servidor** y dejar la web solo para pintar. Es viable, pero hoy la cartera se calcula en el cliente (`CarteraView` manda operaciones y precios en bruto), y el gráfico en directo cada 2 s y las ediciones en el sitio dependen de ello. Sería rediseñar el reparto.
3. **Generar los tipos TypeScript desde OpenAPI.** Cubre tipos y validaciones básicas, no la lógica.

Este es el argumento técnico principal y es real.

### 3.2 Alojamiento gratuito
El despliegue usa Render **plan free**: 512 MB de RAM, 0,1 CPU y se duerme tras 15 min sin uso.
- Node + Fastify arranca en pocos segundos y ocupa del orden de 100 MB.
- Spring Boot con JPA suele necesitar 150-250 MB de heap más 100-150 MB fuera del heap. En 512 MB funciona solo afinando la JVM (`MaxRAMPercentage`, `Xss`, `lazy-initialization`, pool Hikari pequeño). Hay casos documentados de reinicios en bucle por el health check en este mismo plan. Los arranques en frío superan los 30 s.

Como la app se duerme, cada primera visita del día pagaría ese arranque. **Este también es un argumento real**, siempre que se quiera seguir gratis. Con un plan de pago (Starter, 7 $/mes, también 512 MB) mejora poco; hace falta un plan superior para ir holgado.

**Matiz (tras revisarlo con el usuario):**
- LoopDeck ya funciona con Spring Boot en Render: es un backend Maven en Docker con `-XX:MaxRAMPercentage=75`. Así que el problema de memoria se resuelve afinando la JVM; no es un muro.
- Los arranques en frío dan igual con un ping. Cartera ya lo tiene: UptimeRobot llama a `/api/health` cada 5 minutos ([guía](guia.md)). Además lo necesita, porque si el servidor se duerme no se repasan los avisos.
- El límite que de verdad importa son las **horas gratis**: Render da **750 horas al mes por workspace, compartidas por todos los servicios gratuitos**. Un servicio despierto 24/7 gasta unas 720. Si Cartera y LoopDeck están en el mismo workspace y los dos se mantienen despiertos, suman unas 1.440 horas. Hacia el día 15 o 16 del mes se agotan y Render suspende todos los servicios gratuitos hasta el mes siguiente ([docs de Render](https://render.com/docs/free)). Esto pasa sea cual sea el lenguaje.

### 3.3 Una sola cadena de herramientas
Un lenguaje, un gestor de paquetes, un runner de tests (Vitest) y un lint para todo el monorepo. Es comodidad, no algo decisivo.

## 4. Lo que se pierde por no usar Spring Boot

- **Coherencia del portfolio**: el resto de tus proyectos son Spring Boot, y es el stack que más se pide en ofertas de backend en España.
- Herramientas maduras que aquí se han hecho a mano: migraciones (Flyway), seguridad (Spring Security), inyección de dependencias, Actuator y observabilidad.
- Tests de integración con el estándar del sector (Testcontainers, `@SpringBootTest`).

## 5. Valoración (revisada)

Cartera y LoopDeck están en cuentas de Render distintas y un ping evita que se duerman. Así que **el alojamiento no condiciona la decisión**: LoopDeck demuestra que Spring Boot funciona ahí. Tampoco las librerías (punto 2).

**Lo único que queda en contra es técnico y se puede resolver:** el servidor usa la lógica compartida (`computeMetrics`, `computeLedger`, `evaluateAlerts`, `parseRegistro` y los esquemas). Habría que portarla a Java y mantener la copia TypeScript para la web. El riesgo de que las dos copias den resultados distintos se controla con **fixtures *golden* en JSON** que pasen los tests de los dos lados (ya existe `golden.test.ts`).

**A favor de migrar:**
- Coherencia con el resto del portfolio y con el tipo de puesto que buscas (backend Java).
- Es el proyecto con más dominio real (cartera, fiscalidad, avisos, varias fuentes de mercado). En Java luciría más que en TypeScript.
- Herramientas estándar en lugar de código propio: Flyway, Spring Security, Actuator, Testcontainers.

**Coste y riesgo:**
- Reescribir unas 5.500 líneas de servidor y unas 2.100 de tests, y portar la parte de cálculo que usa el servidor.
- La base de datos se puede quedar igual: Flyway arranca con *baseline* sobre el esquema actual y no hay que migrar datos.
- Riesgo de regresiones con datos reales (sesiones, Google, importaciones, avisos). Se mitiga con tests de contrato: la misma batería HTTP contra el servidor viejo y el nuevo.
- Mientras dure la migración, las funciones nuevas o se congelan o se hacen dos veces.

**Recomendación: migrar, pero en paralelo y sin tocar la web.**
1. Crear `apps/server-java` (Spring Boot) con **el mismo contrato HTTP**: mismas rutas y mismo JSON. La web no cambia.
2. Usar el mismo PostgreSQL con Flyway en *baseline*.
3. Portar módulo a módulo: auth → listas e items → mercado → cartera → avisos y push → copias. Cada módulo pasa los mismos tests de API que el de Node.
4. Cambiar el despliegue de Render al JAR cuando haya paridad completa, y retirar `apps/server`.

## Fuentes
- webpush-java: https://github.com/web-push-libs/webpush-java · fork archivado que recomienda interaso/webpush: https://github.com/andreblanke/webpush-java
- Cliente Java de Yahoo sin mantener: https://github.com/sstrickx/yahoofinance-api · funcionamiento actual de cookie y crumb: https://www.sparkproxy.io/blog/how-to-scrape-yahoo-finance · yahoo-finance2 `getCrumb`: https://jsr.io/@gadicc/yahoo-finance2/doc/lib/getCrumb
- Spring Boot en 512 MB: https://snapdeploy.dev/blog/spring-boot-512mb-container · caso real en Render free: https://github.com/utkarshnikhare/my-first-spring-api/pull/35 · comparativa de hosting: https://granite.so/hosting/spring · https://docs.bswen.com/blog/2026-02-28-springboot-free-hosting/
- Postgres embebido en Java: https://github.com/zonkyio/embedded-database-spring-test · https://www.baeldung.com/spring-boot-embed-postgresql-testing
- Datos del repo: `render.yaml` (plan free), recuento de líneas y de imports de `@watchlist/shared`.
