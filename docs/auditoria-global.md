# Auditoría global — noviembre de 2026

Revisión de toda la aplicación: servidor (rutas, cartera, mercado, avisos, cuentas y sesiones), código compartido (libro FIFO, Renta, valoración, avisos) y web (caché de react-query, fechas, pantallas de cartera). Cada fallo indica su gravedad y su estado.

## Críticos (cálculo fiscal)

| # | Fallo | Dónde | Estado |
|---|---|---|---|
| A1 | **Regla de los dos meses, recompra contada dos veces.** Las mismas acciones recompradas podían aplazar la pérdida de varias ventas, tanto con compras anteriores como posteriores. Resultado: pérdidas aplazadas de más y pérdidas computables de menos en la Renta. | `shared/cartera/ledger.ts` | Corregido: cada lote lleva cuántas acciones ya sirven de recompra (escala con splits y se libera al vender). 2 tests. |
| A2 | **Saldo negativo de RCM perdido.** Un año con rendimientos del capital mobiliario negativos (gastos mayores que el dividendo) no se arrastraba los cuatro años siguientes del art. 49 LIRPF. | `shared/cartera/tax.ts` | Corregido: se arrastra, compensa primero con RCM y luego hasta el 25 % de las ganancias, con un límite compartido con la compensación del propio año. En la Renta y en el Excel aparece como «(RCM)». Test. |

## Altos (concurrencia y sincronización)

| # | Fallo | Dónde | Estado |
|---|---|---|---|
| B1 | **Altas, ediciones y borrados de operaciones sin bloqueo.** Dos peticiones a la vez (dos ventas, o una venta y un borrado) validaban el registro cada una por su lado y podían dejarlo descuadrado, por ejemplo vendiendo más de lo que había. Solo la importación bloqueaba, aunque su comentario decía que serializaba también las altas manuales. | `routes.ts` | Corregido: `lockPortfolio` en alta, edición, borrado, cambio de bróker, edición de valor e importación. Test de dos ventas simultáneas. |
| B2 | **Cambio de bróker sin transacción ni validación.** | `POST /api/operations/broker` | Corregido: transacción con bloqueo y `assertValid`. |
| B3 | **Borrar listas sin atomicidad.** Se contaba y se borraba por separado, así que dos borrados a la vez podían dejar cero listas. | `DELETE /api/lists/:id` | Corregido: transacción con `LOCK TABLE lists`. |
| B4 | **Zona horaria del servidor.** En Render el servidor corre en UTC, así que «hoy», las horas de silencio, el resumen diario, los fines de semana, la caducidad de órdenes y el silencio de valores iban una o dos horas desfasados. `/api/market/fx` también tomaba «hoy» en UTC, mientras que el histórico usa Madrid. | `alerts.service.ts`, `calc.ts`, `routes.ts` | Corregido: `TZ=Europe/Madrid` al arrancar, salvo que el entorno diga otra cosa, y `madridToday()` en las rutas. |
| B5 | **Copia diaria y resumen diario marcados antes de hacerse.** Si fallaba la copia o el envío, ese día se quedaba sin copia o sin resumen. | `alerts.service.ts` | Corregido: la marca se guarda después. |
| B6 | **Cambio de divisa de un valor con precios ya apuntados en otra.** Descuadraba la valoración. | `PUT /api/instruments/:ticker`, alta y edición de operaciones | Corregido: error 400 si otra operación del valor ya tiene precio; vincular la cotización más tarde sigue permitido. Test. |

## Medios (rendimiento y recursos)

| # | Fallo | Dónde | Estado |
|---|---|---|---|
| C1 | **Cotizaciones pedidas dos veces.** Varias pantallas, cuentas o el bucle de avisos pedían a la vez el mismo símbolo al proveedor, lo que acerca el límite de 429. | `market.service.ts` | Corregido: cada símbolo tiene una única petición en curso, compartida por todos. Test. |
| C2 | **La memoria de avisos crecía sin fin.** `notified` no se limpiaba nunca, y `levels` conservaba los niveles editados. | `shared/alerts.ts` | Corregido: se olvidan los niveles que ya no existen, los avisos que han pasado la espera y los de caducidad de órdenes ya cambiadas. Test. |
| C3 | **Sesiones caducadas solo se borraban al arrancar.** | `auth.ts` | Corregido: se limpian también al iniciar sesión. |
| C4 | **% del día infravalorado.** El denominador incluía los traspasos en curso y los valores sin cierre anterior. | `shared/cartera/view.ts` | Corregido: la base son solo las posiciones con variación. |

## Revisado sin fallo, o con riesgo aceptado

- **Caché de la web:** todas las mutaciones invalidan todo, y el histórico cuelga de `['portfolio', …]`. Es correcto.
- **Fechas en la web:** usan la hora local del navegador (`localToday`). Es correcto para quien la usa en España.
- **Avisos manuales y automáticos a la vez:** el indicador `running` es por cuenta y el servicio se cachea por esquema. Con una sola instancia de Render basta.
- **Límite de intentos de login:** con 10 000 claves en memoria rechaza en vez de expulsar entradas. Se mantiene así a propósito, porque expulsarlas permitiría reiniciar el contador de un atacante.
- **FIFO por bróker:** el libro no comprueba que cada venta tenga acciones en su propio bróker. No se añade la comprobación, porque podría bloquear registros importados que ya existen.
- **Ajustes:** `update` lee y escribe sin bloqueo; si llegan dos cambios a la vez, gana el último. Es un riesgo aceptable para un solo usuario.
