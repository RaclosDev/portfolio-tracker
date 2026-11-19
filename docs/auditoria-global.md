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
- **Ajustes:** ~~`update` lee y escribe sin bloqueo~~. Corregido en la segunda ronda (S3).

# Segunda ronda

| # | Gravedad | Fallo | Dónde | Estado |
|---|---|---|---|---|
| S1 | Alta | **Divisas en minúsculas.** «usd» y «USD» eran divisas distintas: sin cambio de divisa y valoración errónea. Además se aceptaba cualquier texto. | `shared/cartera/schemas.ts`, migración 9 | Corregido: tres letras, siempre en mayúsculas; la migración normaliza las ya guardadas. Test. |
| S2 | Alta | **Venta de derechos con importe negativo.** Era el único cobro que no lo comprobaba. | `shared/cartera/schemas.ts` | Corregido. |
| S3 | Media | **Ajustes pisados.** Dos cambios a la vez (p. ej. tema y frecuencia) leían la misma base, y uno se perdía. | `settings.repository.ts` | Corregido: se bloquea la tabla dentro de la transacción. Test. |
| S4 | Media | **Restaurar una copia mientras se escribe.** Una operación dada de alta durante la restauración podía colarse o quedar fuera de la copia previa. | `backup.service.ts` | Corregido: bloqueo de operaciones, valores, listas y elementos durante la restauración. |
| S5 | Media | **Mover un valor a una lista inexistente** daba un error 500 (clave ajena). | `routes.ts` | Corregido: 404 «Lista». Test. |
| S6 | Media | **Perfiles pedidos en cada refresco.** Los valores sin perfil en Yahoo se volvían a pedir a cada carga de la cartera. | `portfolio.service.ts` | Corregido: un reintento al día por valor, con memoria acotada. |
| S7 | Media | **Comisiones de un cobro en divisa al editarlo.** El formulario mostraba en euros lo que estaba en la divisa y, al guardar, el cambio se perdía o se aplicaba dos veces. | `OperationDialog.tsx` | Corregido: se muestran en la divisa y el cambio se conserva. |
| S8 | Baja | **Importar con solo el nombre del valor** dejaba el ticker vacío y la fila sin valor. | `shared/cartera/import.ts` | Corregido: el ticker se toma del nombre. Test. |

## Segunda ronda: revisado sin fallo

- **Histórico, exposición, traspasos y FIFO:** los cálculos se han revisado de nuevo y cuadran con los tests.
- **Límite de intentos de login:** usa la IP real, porque `trustProxy` está configurado.
- **Suscripciones push e invalidación de la caché de la web:** correctas.
- **Posición de un valor dentro de su lista:** si se crean dos valores a la vez pueden empatar, pero el orden se desempata por id. Es un efecto menor.
- **Refresco forzado frente al sondeo periódico:** a lo sumo se hace una petición de más.

# Tercera ronda: auditoría integral

Revisión de las once áreas pedidas: cartera, cálculos, cotizaciones, identificación de activos, listas, alertas, gráficos, histórico, backend, interfaz y una batería de pruebas con resultados conocidos.

## Errores críticos

Ninguno nuevo. Los cálculos fiscales y el FIFO cuadran con la batería dorada.

## Errores funcionales (corregidos)

- **F1 (alta) · Precio medio en divisa con el cambio de hoy.** El precio medio de un valor en dólares se calculaba como coste en € × cambio actual, así que variaba con el euro aunque no hubieras comprado ni vendido. Ahora cada lote guarda su coste en la divisa original (`costNative`), y el precio medio se calcula con el cambio de cada compra (`averageNativePrice`). Esto aplica a la ficha del valor y a la tabla de lotes.
- **F2 (media) · Variación del día con compras de hoy.** Las acciones compradas hoy sumaban toda la subida desde el cierre de ayer, aunque se compraron más caras. Ahora su variación es el valor actual menos lo que costaron.

## Errores de datos externos (corregidos)

- **F3 (alta) · Cotización antigua presentada como de hoy.** Yahoo no daba la hora del precio. En fin de semana o festivo, el precio y la variación del viernes se veían como «Hoy». Ahora cada cotización trae `priceTime`, y `quoteSession` da su sesión en hora de Madrid. Si la sesión no es la de hoy:
  - En cartera y en las listas, junto al precio, aparece «cierre dd/mm».
  - La cifra «Cotización de hoy» del resumen y la columna «Hoy» pasan a llamarse «Última sesión».
- Ya estaba cubierto: el aviso de dato guardado cuando falla la fuente (`stale`), la fecha del valor liquidativo de los fondos, el factor 100 de GBp→GBP y las alertas que ignoran cotizaciones caducadas.

## Problemas de arquitectura (riesgo aceptado)

- Los importes son números de coma flotante (DOUBLE en la base de datos), no decimales. Solo se redondean al mostrarlos, a céntimos. El error acumulado está muy por debajo del céntimo en carteras de particular.
- La rentabilidad es TIR (ponderada por dinero), no TWR. Está bien rotulada («TIR anual», «sin anualizar» con menos de un año). Si se quiere comparar con un índice, falta añadir la TWR.
- Las alertas no tienen estados explícitos (activa, disparada, pausada, caducada) ni historial de evaluaciones. Hoy se disparan con un reposo de 12 h y cubren los saltos por hueco.
- Las acciones vendidas hoy no entran en la variación del día. Es coherente con su definición: lo que tienes ahora.

## Mejoras de usabilidad

- Antigüedad del precio visible en cartera y en las listas (F3).
- Pendiente opcional: un selector «TIR / TWR» y una pestaña de historial de cada alerta.

## Tests

- Nuevo `golden.test.ts`, con resultados calculados a mano:
  - Dos compras: 1.950 €, precio medio 106,6667 €, latente +350 € (+21,875 %).
  - Venta parcial FIFO: +235 € realizados, 9 acciones a 111,11 € y 405 € de resultado histórico.
  - Dividendo con retención en origen.
  - Split 2:1.
  - Compra en dólares, con valor al cambio de hoy y precio medio al cambio de la compra.
  - Dos brókers.
  - Cierre total y nueva compra.
  - Variación del día con una compra de hoy.
  - `quoteSession`.
- Faltan:
  - Pruebas de interfaz (no hay pruebas de navegador).
  - Pruebas del proveedor de Yahoo con respuestas grabadas de fin de semana.

## Plan priorizado

1. Hecho en esta ronda: F1, F2 y F3, y la batería dorada.
2. Siguiente: estados e historial de alertas.
3. Después: TWR junto a la TIR.
4. Opcional: importes decimales, si algún día se gestionan carteras grandes o de terceros.
