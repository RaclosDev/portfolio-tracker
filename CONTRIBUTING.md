# Contribuir

Gracias por el interés. Es un proyecto personal, pero las correcciones y las propuestas son bienvenidas.

## Antes de empezar

- Para un fallo o una idea, abre una [issue](https://github.com/RaclosDev/portfolio-tracker/issues/new/choose) con la plantilla que corresponda.
- Las vulnerabilidades no van en issues públicas: sigue la [política de seguridad](SECURITY.md).
- La participación se rige por el [código de conducta](CODE_OF_CONDUCT.md).

## Entorno local

Requiere Java 21, Node.js 22 y Docker.

```bash
docker compose up -d                    # PostgreSQL en localhost:5434
cd backend && ./mvnw spring-boot:run    # API en http://localhost:8080
cd frontend && npm ci && npm run dev    # web en http://localhost:5173
```

La [guía de configuración](docs/guia.md) detalla autenticación, notificaciones y despliegue, y [arquitectura](docs/arquitectura.md) explica cómo se reparte el código entre `backend` y `frontend`.

## Antes de abrir un pull request

```bash
cd backend && ./mvnw verify
cd frontend && npm run lint && npm test && npm run build
```

Son las mismas comprobaciones que ejecuta la CI; `main` solo admite cambios por pull request con la CI y CodeQL en verde.

- Un pull request por cambio, con un título en formato [Conventional Commits](https://www.conventionalcommits.org/es/) en español (`feat(web): …`, `fix(api): …`).
- Acompaña los cambios de comportamiento con sus tests.
- No subas datos reales de carteras, claves ni archivos `.env`.
