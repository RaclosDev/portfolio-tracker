# Watchlist — Requisitos y arquitectura

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
- Solo local: el servidor escucha en `127.0.0.1`, sin cuentas ni nube.
- Funciona en Windows, macOS y Linux con **un único requisito: Node.js ≥ 22.13** (recomendado 24 LTS).
- Sin compilaciones nativas (nada de Python, Visual Studio Build Tools, etc.).
- Datos en un único fichero SQLite (`apps/server/data/watchlist.db`), fácil de copiar.
- Tolerante a fallos de la fuente de datos: si Yahoo no responde se muestra la última cotización guardada marcada como antigua.
- Arquitectura modular para añadir proveedores, cartera real, alertas, gráficos…

## 3. Tecnologías elegidas

| Capa | Elección | Por qué |
|---|---|---|
| Runtime | **Node.js 24 LTS** | Un solo runtime para front y back; instalador oficial en todos los SO |
| Monorepo | **npm workspaces** | Viene con Node, sin herramientas extra |
| Lenguaje | **TypeScript** | Tipos compartidos entre cliente y servidor |
| Backend | **Fastify 5** | Rápido, validación por esquema, ecosistema de plugins |
| Base de datos | **SQLite con `node:sqlite`** (integrado en Node) | Cero dependencias nativas → instala igual en cualquier PC |
| Validación | **Zod** (paquete `shared`) | Un único esquema valida formularios y API |
| Datos de mercado | **yahoo-finance2** detrás de una interfaz `MarketDataProvider` | Gratis, sin API key, cubre acciones y ETF europeos/EE. UU., FX y consenso de analistas |
| Frontend | **React 19 + Vite** | Estándar de la industria, arranque instantáneo |
| Estado servidor | **TanStack Query** | Caché, refresco periódico y reintentos sin código propio |
| Tests | **Vitest** | Misma config que Vite; los cálculos financieros están cubiertos |

Sobre el consenso: Yahoo publica el consenso de analistas (fuente LSEG/Refinitiv), equivalente al de Bloomberg para uso particular. El consenso de Bloomberg requiere terminal de pago. Los objetivos de brókers concretos (Renta 4, etc.) no se publican en APIs gratuitas, por eso se mantienen como campo manual. Para otra fuente (FMP, EODHD, Alpha Vantage…) basta con implementar `MarketDataProvider`.

## 4. Estructura

```
watchlist/
├─ packages/shared/        Tipos, esquemas Zod y cálculos puros (con tests)
├─ apps/server/            API Fastify + SQLite + proveedores de mercado
│  ├─ src/db/              Conexión y migraciones SQL versionadas
│  ├─ src/modules/         lists · items · settings · market · watchlist · backup
│  ├─ seed/                Datos iniciales (importados del Excel)
│  └─ data/                Base de datos (ignorada en git)
├─ apps/web/               React + Vite
│  └─ src/features/        watchlist · items · settings
└─ docs/
```

Flujo: el navegador pide `GET /api/lists/:id/watchlist`; el servidor combina los valores guardados con cotizaciones (caché 60 s), consenso (caché 12 h) y tipos de cambio, aplica los cálculos de `shared` y devuelve filas listas para pintar.

## 5. Siguientes pasos posibles
- Importador directo de Excel/CSV.
- Alertas (notificación de escritorio) al alcanzar un nivel de compra.
- Hoja de cartera real (posiciones, P&L) reutilizando el módulo de mercado.
- Gráfico histórico por valor con los niveles dibujados.
