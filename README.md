# Portfolio Tracker · Watchlist

App de escritorio para vigilar acciones y ETF en los que quieres entrar: hasta 3 precios de compra, distancia a cada uno, precio objetivo de tu bróker y del consenso de analistas, tamaño de la compra con conversión de divisa y órdenes puestas en el banco.

Se abre con un acceso directo, en su propia ventana; al cerrarla se detiene todo. Las cotizaciones vienen de Yahoo Finance. **Se actualiza sola** desde este repositorio cada vez que se abre.

## Instalar (una vez en cada PC)

No hace falta instalar nada antes, solo tener internet durante la instalación.

1. Descarga el proyecto: en GitHub, botón verde **Code → Download ZIP** (o el ZIP que te hayan pasado, generado con `npm run empaquetar`, que además trae la lista inicial de valores). Descomprímelo.
2. Doble clic en **`instalar.bat`** (macOS/Linux: `./instalar.sh`). Tarda menos de un minuto:
   - Te pregunta **dónde instalar** (por defecto `%LOCALAPPDATA%\Watchlist`). Todo queda dentro de esa carpeta: `node` (Node.js portátil, sin permisos de administrador), `app` (el programa) y `datos`.
   - Te pide la **carpeta de datos**. Acepta la propuesta (`…\Watchlist\datos`) o, si vas a usar la app en varios PCs (trabajo y casa), elige en todos **la misma carpeta compartida** (OneDrive, Google Drive, Dropbox…).
   - Crea el acceso directo **Watchlist** en el escritorio y en el menú Inicio y la registra en **Configuración → Aplicaciones instaladas**.
3. Abre **Watchlist** desde el acceso directo. La carpeta descomprimida ya no hace falta.

Si Windows avisa de que el archivo viene de internet, elige **Ejecutar de todas formas** (solo al instalar).

**Desinstalar:** Configuración → Aplicaciones instaladas → Watchlist → Desinstalar. Borra el programa y los accesos directos; los datos se conservan salvo que digas que se borren (y nunca se tocan si están en una carpeta compartida).

**Reinstalar o cambiar de carpeta:** vuelve a ejecutar `instalar.bat`; propone la carpeta de la instalación actual.

## Actualizaciones

La app busca versiones nuevas en la rama `main` de [`RaclosDev/portfolio-tracker`](https://github.com/RaclosDev/portfolio-tracker):

- **Al abrirla**: si hay versión nueva se descarga e instala (aviso "Actualizando…") y luego se abre.
- **Ya compilada**: la GitHub Action publica cada versión de `main` ya compilada (Release `build-<commit>`, menos de 1 MB). Los PCs solo descargan eso y Electron: no necesitan vite, esbuild ni TypeScript, ni compilan al actualizar. Si una versión no tiene compilación publicada, se descarga el código y se compila en el PC como antes.
- **Al instante mientras está en marcha**: cada push a `main` dispara la GitHub Action `avisar-version.yml`, que publica un aviso en un canal de [ntfy.sh](https://ntfy.sh) (`pushTopic` en `watchlist.update.json`). La app mantiene abierta una conexión a ese canal; al recibir el aviso comprueba la versión en GitHub (el aviso por sí solo no instala nada). Si solo está en la bandeja, se actualiza y reinicia sola; si la ventana está abierta, avisa con una notificación y un botón **Actualizar ahora** (si no se pulsa, se instala al cerrar la ventana).
- **Respaldo**: también comprueba al despertar el PC, cada 6 horas y desde el menú de la bandeja (**Buscar actualizaciones**). Las consultas a GitHub son condicionales (ETag): sin cambios no gastan cupo.
- Sin conexión, sigue con la versión instalada. La versión se ve en ⚙ Ajustes → Copias y Excel.

Para publicar cambios: haz commit y `git push` a `main`. Para trabajar sin que llegue todavía a los demás, usa otra rama y fusiónala en `main` cuando esté lista.

## Notificaciones y segundo plano

Al cerrar la ventana, Watchlist sigue en la **bandeja del sistema** (junto al reloj) y comprueba los precios con la misma frecuencia que con la ventana abierta (Ajustes → General, por defecto cada 60 s). Avisa con notificaciones de Windows cuando:

- un valor entra en **zona de compra** o se pone **cerca** de un nivel,
- el precio toca tu **orden** puesta en el banco,
- una orden **caduca** en 2 días o menos.

Cada aviso sale una vez (no se repite en 12 h aunque el precio oscile). En segundo plano la app solo **lee** los datos y no bloquea la carpeta compartida. Clic en el icono de la bandeja: abrir; clic derecho: comprobar ahora, activar/desactivar avisos o **Salir**. Todo se configura en ⚙ Ajustes → Notificaciones (también **Iniciar con Windows**).

## Datos

- Se guardan en la carpeta elegida al instalar: `watchlist.db` (un único fichero, apto para carpetas sincronizadas).
- `copias/`: una copia automática por día (se conservan 30).
- `en-uso.json`: indica qué PC tiene la app abierta. Si la abres en otro PC a la vez, avisa antes de continuar.
- Si la sincronización crea una copia en conflicto (`watchlist-NOMBREPC.db`…), la app lo avisa al abrirse.
- **Usa la app en un PC cada vez** y deja que la carpeta se sincronice antes de abrirla en el otro.
- Los datos **nunca** se suben a GitHub.

Para mover tus valores a otra instalación con otra carpeta de datos: ⚙ Ajustes → **Exportar JSON** / **Importar JSON**.

Valores iniciales: si junto al instalador existe `apps/server/seed/watchlist.seed.json` (no se publica en el repositorio), se cargan la primera vez.

Si la app no abre, el detalle está en `%TEMP%\watchlist-launch.log`. Para cambiar la carpeta de datos, borra `%LOCALAPPDATA%\Watchlist\app\watchlist.local.json` y vuelve a ejecutar `instalar.bat`.

## Uso

La primera vez se abre un **tour guiado** que explica cada parte. Para repetirlo, botón **? Tour** arriba a la derecha.

- **Tarjetas superiores**: valores en zona de compra, cerca (umbral configurable) y órdenes activas. Son clicables y filtran la tabla.
- **Mapa de precios**: barra con el rango de 52 semanas, el precio actual (●), tus niveles de compra (▲, verde si se alcanzó y ámbar si está cerca), el objetivo del bróker (◆) y el consenso de analistas (| media, con su rango encima).
- **Compra 1/2/3**: precio y distancia (%). Negativo = lo que tiene que caer.
- **Acciones**: automático (importe × tipo de cambio / precio de entrada, redondeado siempre a la unidad superior) o el número que fijes tú.
- **Importe / Dif.**: en euros, aunque el valor cotice en USD (también se muestra en su divisa).
- **Orden**: marca la orden puesta en el banco con su precio y fecha; avisa de los días que quedan y de si ha caducado.
- Doble clic en una fila o ✎ para editar. ⚙ para ajustes, colores, listas y copias de seguridad.

### Símbolos

Se usan los de Yahoo Finance: el buscador del formulario acepta nombre, ticker o ISIN. Sufijos habituales: `.MC` Madrid, `.PA` París, `.AS` Ámsterdam, `.DE` Xetra, `.MI` Milán, `.L` Londres, sin sufijo para EE. UU.

## Desarrollo

```bash
npm run desktop    # abre la app de escritorio desde el código, con datos en ./datos (sin actualizar)
npm run dev        # modo desarrollo en el navegador: API :5174 + Vite :5173 con recarga al instante
npm start          # versión navegador compilada en http://localhost:5174
npm test           # tests de cálculos
npm run typecheck  # comprobación de tipos de todo el monorepo
npm run seed -- --force            # recarga los datos iniciales del modo navegador
npm run seed -- copia.json --force # restaura una copia en el modo navegador
```

El modo navegador (`dev`/`start`) usa su propia base de datos en `apps/server/data/`, separada de la de la app de escritorio, así que puedes probar sin tocar tus datos reales.

Estructura: `apps/desktop` (ventana Electron que arranca la API dentro de la app), `apps/server` (API), `apps/web` (interfaz), `packages/shared` (tipos y cálculos).

Variables de entorno opcionales: `PORT` (5174), `HOST` (127.0.0.1), `DATA_DIR`, `QUOTE_TTL_SECONDS` (45), `TARGETS_TTL_HOURS` (12).

Arquitectura, requisitos y decisiones técnicas: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

> Los datos de Yahoo Finance pueden llevar retraso y no son asesoramiento de inversión.
