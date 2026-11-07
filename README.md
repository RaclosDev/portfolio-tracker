# Portfolio Tracker · Watchlist

App de escritorio para vigilar acciones y ETF en los que quieres entrar: hasta 3 precios de compra, distancia a cada uno, precio objetivo de tu bróker y del consenso de analistas, tamaño de la compra con conversión de divisa y órdenes puestas en el banco.

Se abre con un acceso directo, en su propia ventana; al cerrarla se detiene todo. Las cotizaciones vienen de Yahoo Finance. **Se actualiza sola** desde este repositorio cada vez que se abre.

## Instalar (una vez en cada PC)

1. Instala **Node.js LTS** desde <https://nodejs.org> (siguiente, siguiente…).
2. Descarga el proyecto: botón verde **Code → Download ZIP** en GitHub (o la carpeta que te hayan pasado) y descomprímelo donde quieras.
3. Doble clic en **`instalar.bat`** (macOS/Linux: `./instalar.sh`).
   - Te pedirá la **carpeta de datos**. Si vas a usar la app en varios PCs (p. ej. trabajo y casa), elige en todos **la misma carpeta compartida** (OneDrive, Google Drive, Dropbox…).
   - Crea el acceso directo **Watchlist** en el escritorio y en el menú Inicio.
4. Abre **Watchlist** desde el acceso directo.

El programa se instala en `%LOCALAPPDATA%\Watchlist\app` (fuera de la carpeta compartida). La carpeta descargada ya no hace falta, salvo la de datos si la dejaste dentro.

## Actualizaciones

Al abrir la app se comprueba si hay una versión nueva en la rama `main` de [`RaclosDev/portfolio-tracker`](https://github.com/RaclosDev/portfolio-tracker). Si la hay, se descarga e instala (aparece un aviso "Actualizando…") y luego se abre. Sin conexión, se abre la versión instalada. La versión instalada se ve en ⚙ Ajustes.

Para publicar cambios: haz commit y `git push` a `main`. Para trabajar sin que llegue todavía a los demás, usa otra rama y fusiónala en `main` cuando esté lista.

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
