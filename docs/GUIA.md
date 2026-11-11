# Guía de instalación y uso

Web para vigilar acciones y ETF en los que quieres entrar y para llevar la cartera: hasta 3 precios de compra y la distancia a cada uno, objetivo de tu bróker y consenso de analistas, tamaño de la compra con conversión de divisa, órdenes puestas en el banco y la cartera real a partir del registro de operaciones (FIFO), con lo cobrado y el informe para la Renta.

Está en **https://cartera.raclos.es**, protegida con contraseña. Funciona en el PC, el móvil y la tablet. El servidor vigila los precios todo el día y avisa con **notificaciones** (zona de compra, cerca de un nivel, órdenes y un resumen diario). Las cotizaciones vienen de Yahoo Finance.

## Uso

La primera vez se abre una **guía** que explica cada parte (botón **Guía** para repetirla).

- **Listas** en pestañas para vigilar lo que quieres comprar.
- **Cartera**: se calcula del **registro de operaciones** (compras, ventas, dividendos, scrip, derechos, splits…), por lotes FIFO de cada valor y con el bróker de cada operación. Pestañas *Resumen* (reparto por valor, sector y bróker; resultado por año), *En cartera*, *Cerradas*, *Registro* (filtros y cambio de bróker de varias a la vez) y *Renta* (ganancias y pérdidas por año con la regla de los dos meses, compensación y pérdidas pendientes; se descarga en Excel o PDF). Pulsando un valor se abre su ficha con gráfico, lotes y operaciones.
- **Importar operaciones** (en la Cartera): adjunta un Excel `.xlsx`, CSV o TSV de tu bróker. El asistente reconoce los títulos, permite elegir hoja y fila de cabecera, y pide aclarar columnas y tipos desconocidos. La vista previa muestra las operaciones, posibles duplicados y errores antes de añadirlas. Conserva toda la cartera anterior y guarda una copia; puedes recordar la correspondencia de columnas en este navegador.
- **Mapa de precios**: rango de 52 semanas, precio actual, tus niveles de compra, el objetivo del bróker y el consenso.
- **Compra 1/2/3**: precio y distancia (%); se editan pulsando en la celda.
- **Acciones / Importe / Ahorro**: en euros aunque el valor cotice en otra divisa. Las acciones se redondean siempre hacia arriba.
- **Ajustes**: umbrales, colores y columnas, notificaciones, listas, copias de seguridad y Excel.

**En el móvil o la tablet:** abre la web y añádela a la pantalla de inicio (Chrome: menú ⋮ → Añadir a pantalla de inicio; iPhone/iPad: Compartir → Añadir a pantalla de inicio). Después, **Ajustes → Notificaciones → Activar en este dispositivo**. Hay que activarlas en cada dispositivo donde se quieran recibir.

Símbolos: los de Yahoo Finance (el buscador acepta nombre, ticker o ISIN). Sufijos: `.MC` Madrid, `.PA` París, `.AS` Ámsterdam, `.DE` Xetra, `.MI` Milán, `.L` Londres, sin sufijo para EE. UU.

### Importar operaciones de un bróker

Exporta el **historial de operaciones ejecutadas**, con una fila por movimiento. Un resumen de posiciones actuales no contiene el historial necesario para reconstruir los lotes. Se admiten hasta 10 MB por archivo, 20.000 operaciones y 500 valores por importación. Los Excel antiguos `.xls` deben guardarse como `.xlsx`.

Revisa las columnas reconocidas y sus ejemplos. Si el archivo tiene varias fechas o importes, elige los que correspondan a la operación. Puedes indicar un tipo común si todas las filas son compras, o asignar los tipos desconocidos una sola vez para todo el archivo. También puedes excluir tipos o filas. Las fechas y números ambiguos requieren elegir su formato.

Indica si el importe está en euros o en la divisa del valor y si incluye comisiones. Precio y comisiones se interpretan en la divisa del valor; las retenciones, en euros. Para otras divisas hace falta el cambio histórico expresado en unidades de esa divisa por euro. Los cobros netos se convierten a bruto sumando las retenciones y comisiones que hayas indicado. Revisa estos ajustes según el contenido de tu exportación.

En la vista previa puedes vincular un valor con uno existente, revisar su divisa o buscar su cotización. El ISIN también puede servir de identificador; sin símbolo de cotización se conservan las operaciones, pero no habrá precio actual. Se señalan coincidencias de fecha, valor, tipo, cantidades, importes y bróker tanto en el archivo como en la cartera: se omiten por defecto y puedes incluirlas si son operaciones distintas. No se detectarán necesariamente duplicados expresados de otra forma.

Confirma la revisión para añadirlas. Si una venta supera las acciones disponibles u otra operación deja el registro inconsistente, se cancela toda la importación. Las operaciones previamente importadas, incluidas las del antiguo Excel, se conservan.

### Evolución de la cartera

En **Cartera → Resumen**, las cifras principales son la ganancia total desde el inicio, el valor de las acciones, la TIR anual y la variación de cotización de las posiciones actuales. El desglose muestra latente, ganancias realizadas en ventas y cobros. En escritorio, los resultados anuales quedan justo debajo de estas cifras, independientes de la altura del gráfico de la derecha. Solo se muestra un gráfico cada vez: **Resultado**, **Valor**, **Divisas**, **Valores**, **Sectores** o **Brókeres**.

El histórico permite elegir 1, 3 o 6 meses; este año; 1, 2 o 5 años; todo el registro, o fechas concretas. Puedes consultar cada día con el puntero, el selector de fecha o la barra inferior, también con las flechas del teclado. Se reconstruyen las posiciones de cada fecha a partir de las operaciones, incluidas las que ya están cerradas, y se valoran con cierres diarios de Yahoo Finance.

**Resultado**, la vista inicial, mide la ganancia o pérdida económica en euros desde el primer día seleccionado hasta la fecha consultada: **valor final − valor inicial − compras + ventas + cobros**. La base es el cierre anterior al primer día seleccionado, de modo que las operaciones de ese primer día también cuentan. Compras y ventas usan los importes netos registrados; los cobros descuentan comisiones y retención en origen, antes del IRPF español, igual que el resumen. Las reinversiones no duplican el resultado. Por ejemplo, partir de 100.000 € en acciones, vender por 70.000 € y terminar con acciones valoradas en 40.000 € supone un resultado de 10.000 €, aunque el capital que sigue invertido haya bajado. El desglose bajo el gráfico permite comprobarlo. La vista **Valor** conserva el histórico de capital en acciones, sin presentarlo como un porcentaje de rentabilidad.

**Ventas y cobros por año** suma ganancias de ventas (importe cobrado menos coste FIFO), dividendos y otros cobros. No incluye cambios del latente. La ganancia total desde el inicio sí incluye el latente actual. La TIR es anualizada y pondera las fechas de los flujos; no es el porcentaje de variación del capital. «Cotización de hoy» mide únicamente el cambio de precio de las posiciones actuales al cambio actual, no el resultado diario de toda la cuenta. Si falta una cotización actual, los totales que dependen de ella se muestran sin importe para evitar una suma parcial.

La aplicación registra operaciones en valores, no un libro de saldo en efectivo, depósitos o retiradas. Por eso no presenta un patrimonio total de la cuenta ni una rentabilidad TWR de la cuenta. Esta separación entre valoración y rendimiento, con los flujos identificados, sigue el criterio de los informes de [cambio en NAV de PortfolioAnalyst](https://www.ibkrguides.com/orgportal/performanceandstatements/pa-change-in-nav.htm), adaptado a los datos disponibles aquí.

**Divisas** compara el valor de las acciones de cada fecha en euros con el que tendrían manteniendo fijo el cambio del inicio del periodo, también para compras posteriores. La diferencia es el efecto divisa sobre esas posiciones: no incluye el efecto divisa de ventas o cobros ya realizados. Cambiar la fecha inicial cambia esa referencia. Se normalizan las cotizaciones en peniques y los precios históricos ajustados por splits para evitar contar el desdoblamiento dos veces.

Se usa el último cierre conocido hasta cada fecha, con un máximo de siete días naturales para cubrir fines de semana y festivos; nunca un precio posterior. Si faltan precios o cambios, el gráfico deja un hueco y señala los símbolos afectados en lugar de sumar una cartera incompleta. Si falta la valoración inicial, tampoco se calcula el resultado del periodo. El histórico se guarda en caché durante una hora; si Yahoo falla, se advierte al mostrar datos guardados. El último punto puede diferir del valor actual, que usa cotizaciones intradía.

## Puesta en marcha (una vez)

Todo en planes gratuitos: **Neon** (base de datos), **Render** (servidor), **UptimeRobot** (lo mantiene despierto) y el DNS de `raclos.es`.

1. **Neon** → crea un proyecto en la región *AWS Europe Central 1 (Frankfurt)* y copia la cadena de conexión (*Connection string*, con `?sslmode=require`).
2. **Claves de las notificaciones**: en este repositorio ejecuta `npm run claves-push` y guarda las dos claves.
3. **Render** → *New → Blueprint* con este repositorio (`render.yaml`). Rellena:
   - `DATABASE_URL`: la cadena de Neon.
   - `APP_PASSWORD`: la contraseña inicial de la cuenta propietaria (conserva la contraseña anterior al habilitar el registro).
   - `APP_OWNER_EMAIL`: el correo de la cuenta propietaria. Los datos existentes se conservan en la misma base de datos.
   - `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`: las del paso 2.
4. **Despliegue automático**: en Render, *Settings → Deploy Hook*, copia la URL y guárdala en GitHub como secreto del repositorio `RENDER_DEPLOY_HOOK` (*Settings → Secrets and variables → Actions*). Desde entonces, cada push a `main` se despliega solo si pasan los tests.
5. **Dominio**: en el DNS de `raclos.es` crea un `CNAME` `cartera` → `<servicio>.onrender.com` (el que muestra Render en *Settings → Custom Domains*). Render pone el certificado HTTPS solo.
6. **UptimeRobot** → monitor HTTP(s) a `https://cartera.raclos.es/api/health` cada 5 minutos. Así no se duerme y los avisos funcionan siempre.
7. **Datos**: entra en la web, *Ajustes → Copias y Excel → Importar JSON…* con una copia exportada antes (o importa el Excel con *Importar desde Excel o CSV…*).

En producción se necesitan `APP_OWNER_EMAIL`, `APP_PASSWORD` y `SESSION_SECRET`. Al primer arranque con cuentas, los datos existentes se asignan al propietario sin moverlos. La contraseña se guarda como hash scrypt; posteriores cambios de `APP_PASSWORD` no la sustituyen. `APP_OWNER_EMAIL` debe seguir coincidiendo con el propietario. `SESSION_SECRET` firma el flujo de Google; las sesiones se almacenan en la base de datos y se revocan al cerrar sesión.

Para habilitar Google, crea un cliente OAuth de tipo **Aplicación web** en Google Auth Platform. Añade `https://cartera.raclos.es/api/auth/google/callback` como URI de redirección autorizada y configura `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Render. La app pide los permisos `openid email`. Configura la audiencia externa y el estado de publicación en producción para admitir a cualquier usuario.

### Cuentas

- **Crear cuenta** permite registrarse con correo y una contraseña de al menos 12 caracteres. **Continuar con Google** crea la cuenta si todavía no existe.
- Cada cuenta nueva empieza con una lista vacía y sin operaciones. Las listas, la cartera, los ajustes, los avisos y las copias son independientes.
- Si ya te registraste con contraseña, entra primero y usa **Ajustes → General → Vincular Google**, con el mismo correo. No se unen cuentas automáticamente por compartir un correo. Se mantiene el acceso de Google que ya tenía el propietario.
- **Cerrar sesión**, en Ajustes, revoca la sesión de ese dispositivo. Las pestañas abiertas se recargan al cambiar de cuenta.
- Todavía no se envían correos de verificación ni de recuperación de contraseña. Vincular Google permite entrar también por esa vía.

Las copias JSON contienen los datos de la cuenta que las exporta, sin credenciales ni otras cuentas. Para recuperar toda la instalación hay que respaldar la base de datos completa, incluidos `public`, `watchlist_auth` y los esquemas `account_*`.

## Copias de seguridad

- Cada día se guarda una copia completa en la propia base de datos (las 40 últimas) y otra antes de cada importación. Se descargan o restauran en *Ajustes → Copias y Excel*.
- *Exportar JSON* descarga todo (listas, cartera y ajustes); *Exportar a Excel* genera un .xlsx con una hoja por lista y otras con la cartera, las posiciones cerradas y el registro de operaciones.

## Desarrollo

```bash
npm install
npm run dev        # API :5174 + Vite :5173 con recarga al instante
npm start          # web compilada en http://localhost:5174 (antes: npm run build)
npm test           # tests (la base de datos de los tests es un PostgreSQL en memoria)
npm run typecheck
npm run seed -- copia.json --force   # carga una copia en la base de datos local
```

En local no hace falta PostgreSQL: sin `DATABASE_URL` se usa **PGlite** (PostgreSQL en WebAssembly) en `apps/server/data/pg`. Sin `APP_PASSWORD` no se pide contraseña y sin claves VAPID no hay notificaciones.

Variables de entorno: `DATABASE_URL`, `APP_PASSWORD`, `APP_OWNER_EMAIL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUBLIC_URL`, `TZ` (Europe/Madrid), `PORT` (5174), `HOST`, `DATA_DIR`, `QUOTE_TTL_SECONDS` (45), `TARGETS_TTL_HOURS` (12).

Estructura: `apps/server` (API, avisos y notificaciones), `apps/web` (interfaz, PWA), `packages/shared` (tipos y cálculos). Arquitectura y decisiones: [Arquitectura](ARQUITECTURA.md).

> Los datos de Yahoo Finance pueden llevar retraso y no son asesoramiento de inversión.
