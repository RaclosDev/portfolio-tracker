# Capturas de Portfolio Tracker

Interfaz React real, tomada del [modo demo](https://cartera.raclos.es/demo) de la propia aplicación. Las cotizaciones y las velas son las reales del momento de la captura; la cartera, las operaciones, los niveles de compra y las notas son ficticios y no proceden de ninguna cuenta.

Se capturan siete pantallas en escritorio, a 1440 × 900 píxeles CSS con densidad 2×, en tema claro y oscuro (`<pantalla>-light.png` y `<pantalla>-dark.png`):

| Pantalla | Qué muestra |
| --- | --- |
| `watchlist` | Lista de vigilancia con el mapa de precios y los niveles de compra |
| `chart` | Detalle de un valor (`CHART_VALUE`, BBVA por defecto): velas de un año con EMA 50 y 200, volumen, RSI y los niveles sobre el gráfico |
| `portfolio` | Resumen de la cartera: ganancia total, TIR y evolución |
| `positions` | Posiciones abiertas con precio medio, valoración y resultado |
| `exposure` | Exposición por empresa con los fondos y ETF desglosados |
| `operations` | Registro de operaciones |
| `renta` | Calculadora de la renta del ejercicio en curso |

La demo responde en el navegador, así que no hacen falta backend, base de datos ni credenciales. El script:

- bloquea las conexiones externas y las peticiones a la API propia. Las excepciones son los logos de las empresas y las cotizaciones y velas reales de la demo (`/api/public/market/demo`), que se piden a la aplicación publicada (`PUBLIC_ORIGIN` o `LOGOS_ORIGIN` para usar otra);
- fija el reloj en el momento de la captura (o en `CAPTURE_NOW`, en formato ISO), porque la demo fecha sus operaciones respecto a «hoy» y las velas llegan hasta hoy;
- prepara los ajustes guardados (recorridos vistos, indicadores, periodo de un año y vista de velas);
- oculta, solo durante la captura, la banda del modo demo y los avisos emergentes;
- espera a que carguen todas las imágenes y falla si queda algún logo con iniciales de reserva, algún error JavaScript, desbordamiento horizontal o texto visible que mencione la demo.

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

Si Playwright ya está instalado en otro proyecto, `PLAYWRIGHT_PACKAGE_JSON` puede apuntar a su `package.json`. La tipografía es la Inter que incluye la aplicación; no se inyectan fuentes.

Las imágenes publicadas están reducidas a 1920 × 1200, y las de la página de inicio (`frontend/public/landing`: lista, resumen, posiciones y registro) son las mismas capturas en WebP a 1600 × 1000. Con Python y Pillow, desde la raíz:

```bash
python -c "
from PIL import Image; import glob
for p in glob.glob('docs/screenshots/*-*.png'):
    Image.open(p).convert('RGB').resize((1920, 1200), Image.LANCZOS).save(p, optimize=True)
for n in ['watchlist', 'portfolio', 'positions', 'operations']:
    for t in ['light', 'dark']:
        Image.open(f'docs/screenshots/{n}-{t}.png').convert('RGB').resize((1600, 1000), Image.LANCZOS).save(f'frontend/public/landing/{n}-{t}.webp', quality=86, method=6)
"
```

La composición `hero.jpg` reutiliza capturas en tema oscuro. Su generador está en [RaclosDev/scripts](https://github.com/RaclosDev/RaclosDev/tree/main/scripts).
