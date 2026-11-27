# Portfolio Tracker

**Seguimiento de inversiones, desde una lista de vigilancia hasta el registro de operaciones.** Una aplicación personal para ver niveles de compra, ordenar una cartera y consultar cómo se calcula cada posición.

![Portfolio Tracker: lista de vigilancia y resumen de cartera](docs/screenshots/hero.jpg)

[![CI](https://github.com/RaclosDev/portfolio-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/RaclosDev/portfolio-tracker/actions/workflows/ci.yml) [![CodeQL](https://github.com/RaclosDev/portfolio-tracker/actions/workflows/codeql.yml/badge.svg)](https://github.com/RaclosDev/portfolio-tracker/actions/workflows/codeql.yml) [![Licencia MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Arquitectura](docs/arquitectura.md) · [Instalación y uso](docs/guia.md) · [Capturas reproducibles](docs/screenshots/README.md) · [Abrir Portfolio Tracker](https://cartera.raclos.es) · [Demo con datos ficticios](https://cartera.raclos.es/demo)

## Lo más destacado

- **Gráficos de velas con análisis técnico:** nueve intervalos, de 1 minuto a mensual, en velas o en línea. Incluye 16 indicadores (medias SMA, EMA, WMA, HMA y DEMA, bandas de Bollinger, canales de Donchian, Ichimoku, SAR parabólico, RSI, MACD, estocástico, CCI, Williams %R, ROC y ATR) y 13 herramientas de dibujo: tendencias, rayos, canales, retrocesos de Fibonacci, previsiones de operación larga o corta, texto y formas, además de una regla para medir. Tus niveles de compra se ven sobre el propio gráfico.
- **Calculadora de la renta:** ganancias y pérdidas por ejercicio con FIFO por valor (todos los brókers juntos), regla de los dos meses en las recompras, compensación del 25 % entre saldos, arrastre de pérdidas cuatro años y cuota estimada con la escala del ahorro. Dividendos y primas con sus retenciones, y un informe listo para imprimir.
- **Lista de vigilancia con niveles de compra:** acciones, ETF y fondos buscados por nombre, ticker o ISIN, hasta tres niveles de compra por valor, distancia al precio actual y órdenes registradas. Los importes contemplan la conversión de divisa.
- **Exposición real, empresa a empresa:** los fondos y ETF se desglosan con su composición completa (hasta 2.000 posiciones por fondo) para ver cuánto pesa de verdad cada empresa en el conjunto de la cartera, la tengas directamente o a través de varios fondos.
- **Registro con diez tipos de operación:** compras, ventas, dividendos, acciones liberadas (scrip), venta de derechos, primas de emisión y de asistencia, splits y traspasos entre fondos que conservan el coste y la antigüedad.
- **Cartera y evolución:** posiciones abiertas y cerradas, reparto por valor, sector y bróker, rentabilidad y curva histórica reconstruida a partir de las operaciones.
- **Importación de Excel y CSV:** asignación de columnas, vista previa, detección de posibles duplicados y una copia de seguridad antes de aplicar.
- **Avisos en el móvil:** notificaciones push cuando un valor toca un nivel o una orden registrada, con un resumen diario. La aplicación hace seguimiento; no envía operaciones a un bróker.
- **En cualquier pantalla:** PWA instalable con tema claro y oscuro, vista compacta en el móvil, copias diarias y restauración desde la interfaz.

## Un recorrido por la aplicación

<table>
  <tr>
    <td align="center" width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/watchlist-dark.png"><img src="docs/screenshots/watchlist-light.png" alt="Lista de vigilancia con precios, mapa de precios, niveles de compra y distancia a cada nivel" width="440"></picture><br><sub><b>Lista de vigilancia</b> · niveles de compra y distancia</sub></td>
    <td align="center" width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/chart-dark.png"><img src="docs/screenshots/chart-light.png" alt="Detalle de un valor con gráfico de velas, medias exponenciales, volumen, RSI y los niveles de compra sobre el gráfico" width="440"></picture><br><sub><b>Gráfico de velas</b> · indicadores y tus niveles</sub></td>
  </tr>
  <tr>
    <td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/portfolio-dark.png"><img src="docs/screenshots/portfolio-light.png" alt="Resumen de una cartera de ejemplo con ganancia total, TIR y curva de evolución" width="440"></picture><br><sub><b>Cartera</b> · evolución, rentabilidad y totales</sub></td>
    <td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/positions-dark.png"><img src="docs/screenshots/positions-light.png" alt="Posiciones abiertas de la cartera con precio medio, valoración y resultado latente" width="440"></picture><br><sub><b>Posiciones</b> · precio medio, valor y resultado</sub></td>
  </tr>
  <tr>
    <td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/exposure-dark.png"><img src="docs/screenshots/exposure-light.png" alt="Exposición real de la cartera por empresa, con los fondos y ETF desglosados" width="440"></picture><br><sub><b>Exposición</b> · empresa a empresa, fondos y ETF incluidos</sub></td>
    <td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/operations-dark.png"><img src="docs/screenshots/operations-light.png" alt="Registro filtrable de compras, ventas y dividendos con retenciones y bróker" width="440"></picture><br><sub><b>Registro</b> · compras, ventas y dividendos</sub></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/renta-dark.png"><img src="docs/screenshots/renta-light.png" alt="Calculadora de la renta con la cuota estimada, las transmisiones del ejercicio y los dividendos" width="440"></picture><br><sub><b>Renta</b> · ganancias, dividendos y cuota estimada</sub></td>
  </tr>
</table>

Capturas de la interfaz real en escritorio, tomadas de la [demo pública](https://cartera.raclos.es/demo) el 27 de noviembre de 2026; se muestran en claro u oscuro según el tema de GitHub. Las cotizaciones y las velas son las reales de ese día, pero la cartera, las operaciones y los niveles son ficticios: no representan una cuenta ni resultados de inversión. Cada usuario dispone de listas, cartera y ajustes privados.

## Decisiones técnicas que puedes revisar

| Problema | Implementación | Dónde verlo |
| --- | --- | --- |
| Calcular la renta con las reglas fiscales españolas | Motor puro y probado con casos de referencia: FIFO, regla de los dos meses, compensación entre saldos y arrastre de pérdidas | [`tax.ts`](frontend/src/shared/cartera/tax.ts) |
| Indicadores y dibujos sobre el gráfico | 16 indicadores calculados en el cliente y un modelo de dibujos con geometría propia, ambos con pruebas unitarias | [`indicators.ts`](frontend/src/features/watchlist/indicators.ts), [`chartDrawing.ts`](frontend/src/features/watchlist/chartDrawing.ts) |
| Reconstruir posiciones desde operaciones | Cálculo de lotes FIFO separado de la presentación, con pruebas de dominio | [`Ledger.java`](backend/src/main/java/com/cartera/service/portfolio/Ledger.java) |
| Trabajar con datos de mercado externos | Varias fuentes en cadena tras una misma interfaz, con caché y pausa propia ante límites de consultas | [`service/market`](backend/src/main/java/com/cartera/service/market) |
| Recuperar una cartera tras una importación | Copias automáticas y servicio de restauración | [`BackupService.java`](backend/src/main/java/com/cartera/service/backup/BackupService.java) |
| Separar los datos de cada usuario | Correo y contraseña o Google, JWT de corta duración con refresco rotatorio en cookie y cada fila ligada a su cuenta | [`service/auth`](backend/src/main/java/com/cartera/service/auth), [`config`](backend/src/main/java/com/cartera/config) |
| Evolucionar la base de datos sin perder datos | Migraciones Flyway versionadas; la V2 importa los datos de la versión anterior | [`db/migration`](backend/src/main/resources/db/migration) |
| Probar contra la base de datos real | Tests de integración con PostgreSQL en Testcontainers y mínimo de cobertura con JaCoCo | [`backend/src/test`](backend/src/test/java/com/cartera) |

**Stack:** Java 21 · Spring Boot 4 · Spring Security · Spring Data JPA · Flyway · PostgreSQL · React 19 · TanStack Query · Vite · Vitest · JUnit 5 · Testcontainers · Docker · GitHub Actions.

## Desarrollo local

Requiere Java 21, Node.js 22 y Docker.

```bash
docker compose up -d              # PostgreSQL en localhost:5434
cd backend && ./mvnw spring-boot:run   # API en http://localhost:8080
cd frontend && npm ci && npm run dev   # web en http://localhost:5173 (/api va a la API)
```

La [guía de configuración](docs/guia.md) explica autenticación, notificaciones, copias y despliegue. Para comprobar los cambios:

```bash
cd backend && ./mvnw verify       # tests (PostgreSQL en Docker) y cobertura
cd frontend && npm run lint && npm test && npm run build
docker build -t cartera .         # la imagen de producción: web + API
```

La [CI](.github/workflows/ci.yml) pasa lint, tipos, tests de la web y de la API y construye la imagen antes de desplegar; CodeQL analiza el código y Dependabot propone actualizaciones semanales. Las cotizaciones externas pueden tener retraso; la aplicación organiza información y no ofrece asesoramiento de inversión.

## Fuentes de cotización

Se consultan Financial Hub y Yahoo Finance y, para los valores sin precio y con cobertura alternativa, Borsa Italiana / FIDA, Quefondos / VDOS, onvista (bolsas alemanas como Xetra o Tradegate), justETF (ETF por ISIN, en euros) y FT Markets, en ese orden. El buscador por nombre combina los catálogos de onvista y Euronext. Si ninguna responde, se muestra el último precio guardado como tal. Cada proveedor tiene su propia pausa ante límites de consultas.

### Composición de fondos y ETF

La pestaña **Exposición** y la ficha de cada fondo usan su composición. La fuente principal es la API pública de [Financial Hub](https://api.financial-hub.es/docs) (datos de Morningstar, sin clave): con el ISIN encuentra el fondo y da su cartera completa (hasta 2.000 posiciones; la liquidez, las divisas a plazo y los derivados quedan como «sin desglosar»). Si no lo tiene o falla, se prueban extraETF y onvista (por ISIN), FT Markets (fondos y ETF, incluidos los españoles) y Yahoo Finance (por su ticker), que solo dan las 10 mayores posiciones; vale la primera que responde con datos coherentes. La composición se guarda una semana y, si todas las fuentes fallan, se muestra la última conocida.

Borsa aporta el último valor liquidativo de fondos, con su fecha e ISIN; no proporciona una serie histórica desde esa ficha. Se puede buscar el nombre de la clase en «Cotización automática» y elegir el resultado de Borsa. Los identificadores `BORSA:2FADB…` se guardan sin necesitar claves de API. Como su buscador no indexa todos los ISIN, los vínculos verificados por ISIN están en `BorsaProvider.java` y se comprueban contra la ficha en cada actualización. No hay cobertura universal ni conversión automática entre clases de un fondo.

Quefondos permite buscar fondos por su ISIN y aporta NAV fechado y observaciones mensuales para los gráficos individuales, sin clave de API. Los tickers de Yahoo con correspondencia verificada están en `QuefondosProvider.java`; cada ficha debe coincidir con su ISIN y divisa. Sus datos mensuales no sustituyen los cierres diarios del resumen: si un valor carece de histórico diario, se muestra una curva parcial de los valores disponibles, excluyendo también todas las operaciones de los omitidos y avisando de ello.

Para añadir una fuente, se implementa `MarketDataProvider` y se añade, en su orden, a la lista de `FallbackProvider` en [`MarketConfig.java`](backend/src/main/java/com/cartera/service/market/MarketConfig.java). Una fuente solo cubre los símbolos que puede identificar con seguridad; una respuesta vacía permite probar la siguiente.
