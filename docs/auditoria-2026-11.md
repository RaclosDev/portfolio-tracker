# Auditoría de la app (noviembre 2026)

Revisión de toda la app mirando qué echaría en falta alguien que gestiona carteras: registro, rentabilidad, riesgo, costes, fiscalidad, calidad de los datos y facilidad de uso. Cada punto lleva una prioridad: **P1** cambia decisiones o evita errores, **P2** es una mejora clara, **P3** es un extra.

## Qué está bien

- El registro es sólido. Tiene FIFO, traspasos de fondos con diferimiento, scrip, primas, splits y la regla de los dos meses, y una pestaña de Renta lista para la declaración.
- La exposición por transparencia, con los fondos abiertos empresa a empresa y sus filtros, es algo que muy pocas apps tienen.
- Precios con varias fuentes de respaldo: Financial Hub primero, luego Yahoo y el resto, y cada precio indica de qué fuente viene.
- Tiene copias de seguridad, instantáneas y modo sin conexión.

## Arreglado en esta revisión

- **Alta de operaciones por nombre** (P1). Antes había que escribir un ticker a mano antes de poder buscar, así que no se podía registrar una compra de algo que no estuviera ya en la lista. Ahora el primer campo de «Nueva operación» es **Valor**, que busca por nombre, ISIN o ticker. Al elegirlo se rellenan solos el ticker, el nombre, la divisa y el precio. El ticker se puede cambiar; si ya lo usa otro valor, se propone el símbolo completo.

## 1. Registro y datos de entrada

| # | Prioridad | Qué falta | Por qué importa |
|---|---|---|---|
| 1.1 | P1 | **Importar los extractos de MyInvestor** (CSV de «Todas las transacciones») y de otros brókeres. | Hoy cada compra se mete a mano o se importa con una ayuda manual. Ese es el principal origen de errores. |
| 1.2 | P1 | **Cambio de divisa propuesto automáticamente** en compras en USD, GBP, etc., tomado del cambio del día de la operación (la app ya tiene `/api/market/fx`). | Hoy hay que escribirlo a mano. Si se pone mal, el coste fiscal en euros sale mal. |
| 1.3 | P1 | **Efectivo por bróker** (saldo, ingresos y retiradas de dinero). | Sin él no hay patrimonio total ni peso real de cada posición, y la rentabilidad no separa lo que se aporta de lo que se gana. |
| 1.4 | P2 | **Identificar cada valor por ISIN y bolsa**, no por el ticker que escribe el usuario. | El caso de TWN, CHIP y LSMC: un mismo ETF en dos bolsas acabó como dos valores distintos y hubo que fusionarlos a mano. |
| 1.5 | P2 | Más tipos de operación: intereses de cuenta remunerada, comisiones de custodia, fusiones y canjes, escisiones y cambios de nombre. | Hoy hay que forzarlos con otros tipos, lo que descuadra el coste o la Renta. |

## 2. Rentabilidad

| # | Prioridad | Qué falta | Por qué importa |
|---|---|---|---|
| 2.1 | P1 | **Rentabilidad ponderada por tiempo (TWR)** además de la TIR, por periodos: este año, 1 año, 3 años y desde el inicio. | La TIR mezcla el acierto de las inversiones con cuándo se metió el dinero. La TWR es la cifra que publican los fondos y la única comparable con un índice. |
| 2.2 | P1 | **Comparar con un índice de referencia** (MSCI World, S&P 500 o IBEX) con las mismas aportaciones: «si lo mismo lo hubieras metido en un indexado, hoy tendrías X». | Es la pregunta clave de cualquier gestor: ¿compensa elegir valores frente a indexarse? |
| 2.3 | P2 | **Atribución**: cuánto ha aportado cada posición al resultado del periodo, en euros y en puntos. | Muestra qué ha movido realmente la cartera. |
| 2.4 | P2 | TIR por posición, en la pestaña En cartera. | La rentabilidad simple de una posición con varias compras engaña. |

## 3. Riesgo y concentración

| # | Prioridad | Qué falta | Por qué importa |
|---|---|---|---|
| 3.1 | P1 | **Avisos de concentración**: una empresa por encima del X % del total contando lo que viene a través de fondos, peso de las 10 mayores y solapamiento entre ETF. | En los datos de prueba, la Exposición ya muestra una sola empresa con el 27,7 %, sumando lo directo y lo que viene en varios ETF temáticos. Hoy solo se ve si se va a buscar. |
| 3.2 | P2 | **Volatilidad, caída máxima desde máximos, beta frente al índice y ratio de Sharpe**, calculados con la serie histórica que ya existe. | Sin medir el riesgo, la rentabilidad sola no dice si se está bien compensado. |
| 3.3 | P2 | **Reparto por sector, país y divisa contando lo que hay dentro de los fondos.** | Hoy «Sectores» trata un ETF como un sector propio. Falta comprobar si Financial Hub da el desglose de cada fondo. |
| 3.4 | P3 | Pesos objetivo y **propuesta de rebalanceo** («con 1.000 € nuevos, compra esto»). | Ayuda a ser disciplinado sin tener que hacer cálculos. |

## 4. Costes

| # | Prioridad | Qué falta | Por qué importa |
|---|---|---|---|
| 4.1 | P2 | **Gastos corrientes (TER) de cada fondo y ETF y su coste anual en €**, más las comisiones pagadas al bróker cada año. | Es el único rendimiento seguro: lo que no se paga en costes. Hoy la app no lo muestra en ningún sitio. |

## 5. Fiscalidad

| # | Prioridad | Qué falta | Por qué importa |
|---|---|---|---|
| 5.1 | P2 | **Simulador de venta**: «si vendo N participaciones hoy, gano X y pago Y», con FIFO y la regla de los dos meses. | Evita sorpresas en la declaración antes de dar la orden. |
| 5.2 | P2 | **Pérdidas latentes que se pueden aprovechar** antes de fin de año, avisando de la regla de los dos meses. | Ahorro fiscal directo y legal. |
| 5.3 | P3 | Aviso del **modelo 720/721** (más de 50.000 € en el extranjero) y del límite de la deducción por doble imposición internacional. | Son obligaciones y deducciones fáciles de olvidar. |

## 6. Calidad de los datos

| # | Prioridad | Qué falta | Por qué importa |
|---|---|---|---|
| 6.1 | P1 | **Que Financial Hub use el ISIN guardado de cada valor**, no solo el símbolo. | Hoy CHIP.PA cae a Yahoo porque la búsqueda de Financial Hub por «CHIP» no lo encuentra. Con el ISIN, que ya está guardado, el acierto sería directo. |
| 6.2 | P2 | **Panel «Salud de los datos»**: valores sin precio, precios de más de 3 días, valor liquidativo sin actualizar, divisas que no cuadran y operaciones marcadas «a revisar». | Un número mal es peor que no tenerlo. Hoy los avisos están repartidos por la app. |

## 7. Informes y uso

| # | Prioridad | Qué falta | Por qué importa |
|---|---|---|---|
| 7.1 | P2 | **Informe mensual o trimestral en PDF**, al estilo de la ficha de un fondo: valor, rentabilidad frente al índice, movimientos, cobros y mayores posiciones. | Da una visión periódica sin tener que entrar en la app. |
| 7.2 | P3 | **Resumen en lenguaje llano** en la parte de arriba: «Has puesto X €, ahora vale Y €, ganas Z € (W % al año)». | La app la usa una persona no técnica. Términos como latente, TIR o VL necesitan una traducción visible, no solo una nota al pasar el ratón. |

## Orden propuesto

1. **Fase 1** (lo que cambia decisiones): efectivo y patrimonio total (1.3), TWR más comparación con el índice (2.1 y 2.2), avisos de concentración (3.1), cambio de divisa automático (1.2), importación de MyInvestor (1.1) y Financial Hub por ISIN (6.1).
2. **Fase 2**: riesgo (3.2), costes (4.1), reparto por sector y país (3.3), simulador fiscal (5.1 y 5.2), salud de los datos (6.2) y atribución (2.3).
3. **Fase 3**: identidad por ISIN (1.4), tipos de operación nuevos (1.5), rebalanceo (3.4), informes (7.1) y resumen llano (7.2).
