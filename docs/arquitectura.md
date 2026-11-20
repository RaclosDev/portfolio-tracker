# Portfolio Tracker — Requisitos y arquitectura

## 1. Punto de partida (Excel "Vigilar nuevas")

| Columna Excel | Significado | En la app |
|---|---|---|
| Acción / Ticker | Nombre y símbolo (tipo de dato "Acciones" de Excel) | `name`, `symbol` (símbolo Yahoo: `ALM.MC`, `MCD`, `4COP.DE`…) |
| Variación día / P Actual | Cotización en vivo | Automático (Yahoo Finance) |
| P Com 1 / P Com 2 + Diferencia | Precios de compra y distancia % al precio actual | Hasta **3 niveles** (`buyPrices[]`), distancia = (nivel − actual) / actual |
| P.O. R4 | Precio objetivo de un bróker (Renta 4) | `brokerTarget` + `brokerName` (manual) |
| — (nuevo) | Precio objetivo de consenso | Automático: media/mediana/máx/mín, nº analistas y recomendación |
| Invertir € | Importe a invertir (2.500 €) | `investAmount` (o valor por defecto en Ajustes) |
| acc calc | Acciones = importe / P Com 1 (convertido a USD si aplica) | Calculado con el tipo de cambio en vivo |
| Acc compr | Acciones redondeadas a mano | `sharesOverride` |
| Neto | Acciones × P Com 1 (en la divisa del valor) | Calculado, y también en € |
| Dif. en € | Acciones × (actual − P Com 1) | Calculado **en €** (el Excel no convertía USD) |
| Amarillo + Hasta | Orden de compra puesta en el banco y su vencimiento | `orderActive`, `orderPrice`, `orderUntil` (aviso si vence/caducó) |
| Azul claro | Valores en USD | Etiqueta de divisa automática |
| Notas | Texto libre | `notes` |

Problemas del Excel que la app resuelve:
- `#VALUE!` en la columna de nombre (dependía del tipo de dato de Microsoft) y en el ETF, que no está en esa base de datos.
- El tipo de cambio estaba en otra hoja y había que mantenerlo a mano.
- "Dif. en €" de valores USD quedaba en dólares.
- `#DIV/0!` cuando no hay precio de compra.

## 2. Requisitos

**Funcionales**
1. Varias listas (p. ej. "Vigilar nuevas", "Dividendos"…), cada una con sus valores.
2. Alta/edición/baja de valores con buscador por nombre o ticker (acciones y ETF de cualquier bolsa).
3. Cotización, variación diaria y rango de 52 semanas actualizados automáticamente.
4. Hasta 3 precios de compra; distancia % a cada uno y estado visual: *alcanzado*, *cerca* (umbral configurable, 5 % por defecto) o *lejos*.
5. Barra visual por fila con rango 52 semanas, precio actual, niveles de compra y objetivos.
6. Precio objetivo del bróker (manual) y de consenso (automático) con su potencial %.
7. Cálculo de acciones, neto y diferencia en € con conversión de divisa automática.
8. Órdenes activas con fecha de vencimiento y aviso de caducidad.
9. Ordenar por cualquier columna, filtrar por texto.
10. Copia de seguridad: exportar / importar JSON.

**No funcionales**
- Web en internet (`cartera.raclos.es`), usable desde cualquier PC, móvil o tablet, protegida con contraseña.
- Alojamiento gratuito: Render (servidor), Neon (PostgreSQL) y UptimeRobot (lo mantiene despierto).
- Avisos de precio en el servidor, 24 h, enviados como notificaciones Web Push a los dispositivos activados.
- Una sola imagen Docker con la web y la API; en local, PostgreSQL en Docker (`docker compose up -d`).
- Tolerante a fallos de la fuente de datos: si Yahoo no responde se muestra la última cotización guardada marcada como antigua.
- Arquitectura modular para añadir proveedores, cartera real, alertas, gráficos…

## 3. Tecnologías elegidas

| Capa | Elección | Por qué |
|---|---|---|
| Backend | **Java 21 + Spring Boot 4** (Web MVC, Security, Data JPA, Validation, Actuator) | Estándar en empresa; capas controller → service → repository |
| Base de datos | **PostgreSQL** (Neon) con **Flyway** | Gratis en la nube; migraciones versionadas que se aplican al arrancar |
| Autenticación | **JWT** de 15 min + refresco rotatorio en cookie `HttpOnly`; Google Identity Services | Sin estado en el servidor salvo los refrescos, revocables |
| Notificaciones | **Web Push** (VAPID, service worker) | Llegan al móvil y al PC sin instalar apps |
| Alojamiento | **Render** (Docker), dominio propio | Despliegue desde GitHub tras pasar la CI |
| Datos de mercado | Yahoo Finance detrás de una interfaz `MarketDataProvider` | Gratis, sin API key, cubre acciones y ETF europeos/EE. UU., FX y consenso de analistas. Detrás, en orden: Borsa Italiana, Quefondos, onvista, justETF y FT Markets. La composición de fondos (`service/market/composition`) sale de Financial Hub, extraETF, onvista, FT Markets y Yahoo |
| Frontend | **React 19 + Vite + TypeScript** | Estándar de la industria, arranque instantáneo |
| Estado servidor | **TanStack Query** | Caché, refresco periódico y reintentos sin código propio |
| Tests | **JUnit 5 + Testcontainers + JaCoCo** (API), **Vitest** (web) | La API se prueba contra PostgreSQL real |

Sobre el consenso: Yahoo publica el consenso de analistas (fuente LSEG/Refinitiv), equivalente al de Bloomberg para uso particular. El consenso de Bloomberg requiere terminal de pago. Los objetivos de brókers concretos (Renta 4, etc.) no se publican en APIs gratuitas, por eso se mantienen como campo manual. Para otra fuente (FMP, EODHD, Alpha Vantage…) basta con implementar `MarketDataProvider`.

## 4. Estructura

```
watchlist/
├─ backend/                API Spring Boot (Maven)
│  ├─ src/main/java/com/cartera/
│  │  ├─ controller/       Endpoints REST (/api/…)
│  │  ├─ service/          auth · watchlist · portfolio · market · alerts · backup
│  │  ├─ repository/       Acceso a datos (JPA y consultas SQL)
│  │  ├─ model/ · dto/     Tablas y contratos de la API
│  │  └─ config/           Seguridad, JWT, CORS, límites de peticiones y la web estática
│  ├─ src/main/resources/db/migration/   Migraciones Flyway (V1 esquema, V2 datos de la versión anterior)
│  └─ src/test/            Tests con PostgreSQL en Testcontainers
├─ frontend/               React + Vite (PWA: manifest y service worker en public/)
│  └─ src/features/        watchlist · portfolio · items · import · alerts · settings · auth
├─ Dockerfile              Compila web y API y las sirve juntas (Java 21 JRE)
├─ docker-compose.yml      PostgreSQL local (y la imagen con --profile app)
└─ docs/
```

Flujo: el navegador pide `GET /api/lists/:id/watchlist`; el servidor combina los valores guardados con cotizaciones (caché 60 s), consenso (caché 12 h) y tipos de cambio, aplica los cálculos (`service/watchlist/Metrics`) y devuelve filas listas para pintar.

## 5. Avisos

Todas las cuentas comparten tablas (esquema `cartera`) y cada fila lleva su `user_id`; el servidor lo toma del JWT, nunca de un parámetro del cliente, y un recurso de otra cuenta responde 404. Solo la caché de mercado (`market_cache`) es común. La migración V2 importó los datos de la versión anterior (un esquema por cuenta) y dejó esos esquemas como copia.

El planificador recorre las cuentas y ejecuta avisos y copias con los servicios de cada una. Cada notificación lleva el identificador de cuenta; el service worker comprueba la sesión antes de mostrarla para evitar avisos de otra cuenta en un dispositivo compartido.

El servidor ejecuta `AlertScheduler` cada minuto (solo con `ALERTS_SCHEDULER=true`) (o la frecuencia de Ajustes): calcula todas las listas (la
cartera no genera avisos), compara con la memoria de avisos (`alert_state`), guarda lo nuevo en `alert_history` y lo envía a cada
suscripción de `push_subscriptions`. Respeta fines de semana, horas de silencio y el resumen diario (hora de
España, `TZ=Europe/Madrid`). También guarda una copia diaria en `snapshots`.
