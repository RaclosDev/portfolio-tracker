# Guía de instalación y uso

Web para vigilar acciones y ETF en los que quieres entrar y para llevar la cartera: hasta 3 precios de compra y la distancia a cada uno, objetivo de tu bróker y consenso de analistas, tamaño de la compra con conversión de divisa, órdenes puestas en el banco y la cartera real a partir del registro de operaciones (FIFO), con lo cobrado y el informe para la Renta.

Está en **https://cartera.raclos.es**, protegida con contraseña. Funciona en el PC, el móvil y la tablet. El servidor vigila los precios todo el día y avisa con **notificaciones** (zona de compra, cerca de un nivel, órdenes y un resumen diario). Las cotizaciones vienen de Yahoo Finance.

## Uso

La primera vez se abre una **guía** que explica cada parte (botón **Guía** para repetirla).

- **Listas** en pestañas para vigilar lo que quieres comprar.
- **Cartera**: se calcula del **registro de operaciones** (compras, ventas, dividendos, scrip, derechos, splits…), por lotes FIFO de cada valor y con el bróker de cada operación. Pestañas *Resumen* (reparto por valor, sector y bróker; resultado por año), *En cartera*, *Cerradas*, *Registro* (filtros y cambio de bróker de varias a la vez) y *Renta* (ganancias y pérdidas por año con la regla de los dos meses, compensación y pérdidas pendientes; se descarga en Excel o PDF). Pulsando un valor se abre su ficha con gráfico, lotes y operaciones.
- **Importar Excel** (en la Cartera): lee la hoja *Registro* del Excel de cartera. Volver a importar sustituye lo importado antes (lo añadido a mano se queda) y antes guarda una copia.
- **Mapa de precios**: rango de 52 semanas, precio actual, tus niveles de compra, el objetivo del bróker y el consenso.
- **Compra 1/2/3**: precio y distancia (%); se editan pulsando en la celda.
- **Acciones / Importe / Ahorro**: en euros aunque el valor cotice en otra divisa. Las acciones se redondean siempre hacia arriba.
- **Ajustes**: umbrales, colores y columnas, notificaciones, listas, copias de seguridad y Excel.

**En el móvil o la tablet:** abre la web y añádela a la pantalla de inicio (Chrome: menú ⋮ → Añadir a pantalla de inicio; iPhone/iPad: Compartir → Añadir a pantalla de inicio). Después, **Ajustes → Notificaciones → Activar en este dispositivo**. Hay que activarlas en cada dispositivo donde se quieran recibir.

Símbolos: los de Yahoo Finance (el buscador acepta nombre, ticker o ISIN). Sufijos: `.MC` Madrid, `.PA` París, `.AS` Ámsterdam, `.DE` Xetra, `.MI` Milán, `.L` Londres, sin sufijo para EE. UU.

**Fondos de inversión:** se pueden registrar participaciones con decimales. Para actualizar el precio, selecciona en Yahoo la misma clase y divisa del fondo; conserva su símbolo completo, por ejemplo `0P0001OJNQ.F`, sin añadir `.MC`. En la ficha del valor y al añadir una operación puedes buscar por nombre y comprobar el símbolo. Si solo tienes un ISIN o Yahoo no ofrece esa clase, deja la cotización vacía: las operaciones se conservan, pero el valor queda sin precio actualizado y no suma en la valoración. Los precios de los fondos dependen de las actualizaciones que publique Yahoo.

### Evolución de la cartera

En **Cartera → Resumen**, el desglose del resultado permanece visible junto a un gráfico que puedes cambiar con las flechas o sus botones: **Evolución**, **Divisas**, **Por valor**, **Por sector** y **Por bróker**. Debajo siguen los resultados por año y las cifras desde el principio.

El histórico permite elegir 1, 3 o 6 meses; 1, 2 o 5 años; todo el registro, o fechas concretas. Puedes consultar cada día con el puntero, el selector de fecha o la barra inferior, también con las flechas del teclado. Se reconstruyen las posiciones de cada fecha a partir de las operaciones, incluidas las que ya están cerradas, y se valoran con cierres diarios de Yahoo Finance. Las compras y ventas afectan al valor mostrado: su variación no representa por sí sola la rentabilidad. No incluye efectivo ni cobros.

**Divisas** compara esa valoración en euros con la que tendría manteniendo fijo el cambio del inicio del periodo, también para compras posteriores. La diferencia es el efecto divisa del periodo seleccionado. Cambiar la fecha inicial cambia esa referencia. Se normalizan las cotizaciones en peniques y los precios históricos ajustados por splits para evitar contar el desdoblamiento dos veces.

Se usa el último cierre conocido hasta cada fecha, con un máximo de siete días naturales para cubrir fines de semana y festivos; nunca un precio posterior. Si faltan precios o cambios, el gráfico deja un hueco y señala los símbolos afectados en lugar de sumar una cartera incompleta. El histórico se guarda en caché durante una hora; si Yahoo falla, se advierte al mostrar datos guardados. El último punto puede diferir del valor actual, que usa cotizaciones intradía.

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
