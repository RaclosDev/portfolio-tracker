# Contribuir

Gracias por el interés. Es un proyecto personal, pero las correcciones y las propuestas son bienvenidas.

## Antes de empezar

- Para un fallo o una idea, abre una [issue](https://github.com/RaclosDev/portfolio-tracker/issues/new/choose) con la plantilla que corresponda.
- Las vulnerabilidades no van en issues públicas: sigue la [política de seguridad](SECURITY.md).
- La participación se rige por el [código de conducta](CODE_OF_CONDUCT.md).

## Entorno local

Requiere Node.js 22.13 o superior.

```bash
npm ci
npm run dev
```

La web arranca en `http://localhost:5173` y la API en `http://localhost:5174`. Sin `DATABASE_URL` se usa PGlite local, así que no hace falta instalar PostgreSQL. La [guía de configuración](docs/guia.md) detalla autenticación, notificaciones y despliegue, y [arquitectura](docs/arquitectura.md) explica cómo se reparte el código entre `apps/server`, `apps/web` y `packages/shared`.

## Antes de abrir un pull request

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Son las mismas comprobaciones que ejecuta la CI; `main` solo admite cambios por pull request con la CI y CodeQL en verde.

- Un pull request por cambio, con un título en formato [Conventional Commits](https://www.conventionalcommits.org/es/) en español (`feat(web): …`, `fix(server): …`).
- Acompaña los cambios de comportamiento con sus tests.
- No subas datos reales de carteras, claves ni archivos `.env`.
