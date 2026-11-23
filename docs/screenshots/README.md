# Capturas de Portfolio Tracker

Interfaz React real, tomada del [modo demo](https://cartera.raclos.es/demo) de la propia aplicación. Los nombres de los valores son reconocibles, pero los precios, operaciones y resultados son ficticios; no proceden de una cuenta ni representan cotizaciones actuales.

Se capturan la lista de vigilancia, el resumen de cartera, las posiciones, la exposición y el registro de operaciones en escritorio, a 1440 × 900 píxeles CSS con densidad 2×, en tema claro y oscuro (`<pantalla>-light.png` y `<pantalla>-dark.png`). Las imágenes publicadas están reducidas a 1920 × 1200.

La demo responde en el navegador, así que no hacen falta backend, base de datos ni credenciales. El script fija la fecha, bloquea las conexiones externas y las peticiones a la API, y comprueba que no hay errores JavaScript ni desbordamiento horizontal. La única excepción son los logos de las empresas, que se piden a la aplicación publicada (`LOGOS_ORIGIN` para usar otra).

Con Node.js 22:

```bash
cd frontend
npm ci
npm install --no-save --package-lock=false @playwright/test
npx playwright install chromium
npm run dev -- --host 127.0.0.1
```

En otra terminal, desde la raíz:

```bash
node docs/screenshots/capture.mjs http://127.0.0.1:5173 light
node docs/screenshots/capture.mjs http://127.0.0.1:5173 dark
```

Si Playwright ya está instalado en otro proyecto, `PLAYWRIGHT_PACKAGE_JSON` puede apuntar a su `package.json`. La tipografía es la Inter que incluye la aplicación; no se inyectan fuentes ni estilos.

La composición `hero.jpg` reutiliza las capturas de la lista y del resumen en tema oscuro. Su generador está en [RaclosDev/scripts](https://github.com/RaclosDev/RaclosDev/tree/main/scripts). Las imágenes de la página de inicio (`frontend/public/landing`) son estas mismas capturas en WebP a 1600 × 1000.
