# Capturas de Portfolio Tracker

Interfaz React real con datos sintéticos de demostración. Los nombres de valores son reconocibles, pero los precios, operaciones y resultados son ficticios; no proceden de una cuenta ni representan cotizaciones actuales.

Se capturan la lista de vigilancia, el resumen de cartera y el registro de operaciones a 430 × 932 píxeles CSS (densidad 2×). El script bloquea conexiones externas y cualquier petición API no prevista. No necesita backend, base de datos ni credenciales.

Con Node.js 24 y las dependencias del proyecto instaladas:

```bash
npm install --no-save --package-lock=false @playwright/test
npx playwright install chromium
npm run dev -w @watchlist/web -- --host 127.0.0.1
```

En otra terminal, desde la raíz:

```bash
node docs/screenshots/capture.mjs http://127.0.0.1:5173
```

Si Playwright ya está instalado en otro proyecto, `PLAYWRIGHT_PACKAGE_JSON` puede apuntar a su `package.json`. El script comprueba que la interfaz está lista, que no hay errores JavaScript ni desbordamiento horizontal. La tipografía sigue la pila de sistema de la aplicación; no se inyectan fuentes ni estilos de producto.

La composición `hero.jpg` reutiliza estas capturas. Su generador y las fuentes comunes están en [RaclosDev/scripts](https://github.com/RaclosDev/RaclosDev/tree/main/scripts).
