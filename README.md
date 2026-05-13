# Cogni-Threat - Backend

Backend desarrollado con NestJS, TypeScript y Prisma para la gestión, monitoreo y análisis de amenazas cibernéticas.

## Quick Start With Docker

This is the recommended path for community users. Keep `cogni-threat` and `cogni-threat-front` as sibling directories, then run the full stack from this backend repository.

```bash
corepack enable
cp .env.template .env
docker compose up --build
```

The default compose stack starts PostgreSQL, the NestJS API, and the frontend container. The frontend is exposed on `http://localhost:8080` by default and proxies API traffic to the backend container.

Use `API_HOST_PORT`, `FRONT_PORT`, and `DB_PORT` when you need to change host ports. Keep `API_PORT=3000` unless you intentionally change the port used inside the API container.

Before the first boot, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. The API automatically creates or updates that user as `ADMIN/WRITE` during startup, so the first login can continue setup from the UI.

Before exposing a production deployment, set strong values for `DB_PASSWORD`, `JWT_SECRET`, `SECRETS_MASTER_KEY`, `ADMIN_PASSWORD`, and `CORS_ORIGIN`.

After signing in, go to **Administración → Fuentes, credenciales e IA** to configure external API credentials and Ollama/RAG settings. Ollama values stored from the panel override `.env` fallbacks without restarting the container.

## AI Provider And Embeddings

CogniThreat uses **Ollama** as the built-in open-source AI provider for chat and embeddings. This keeps the default setup self-hosted and avoids requiring paid API keys.

Configurable from the admin panel:

* Ollama URL.
* Chat model.
* Embedding model.
* RAG retrieval and generation parameters.

`EMBEDDING_DIM` stays in `.env` because it must match the vector dimension stored in PostgreSQL/pgvector. If you switch to an embedding model with a different dimension, update `EMBEDDING_DIM` before indexing data and rebuild/reindex embeddings. Changing it after data exists requires regenerating the vector index.

OpenAI-compatible APIs are not supported yet. Adding them should be done as an explicit provider option (`ollama` / `openai`) with separate API-key, chat-model, embedding-model, and base-URL settings.

## Docker Smoke Test

Use this before opening a release or sharing setup instructions:

```bash
docker compose up --build
curl http://localhost:3000/health
```

Then open `http://localhost:8080` and sign in with the administrator configured through `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Tecnologías utilizadas

* NestJS
* TypeScript
* Prisma ORM
* PostgreSQL
* Swagger
* Docker
* pnpm

---

# Requisitos

* Docker and Docker Compose for the recommended full-stack setup.
* Node.js 22 or higher and pnpm for local backend development.
* PostgreSQL when running the backend without Docker.

El proyecto utiliza Corepack para gestionar la versión de pnpm.

---

# Local Development

Clonar el repositorio:

```bash
git clone <url-del-repositorio>
cd cogni-threat-back
```

Instalar dependencias:

```bash
corepack enable
pnpm install
```

---

# Configuración

Copiar el archivo de ejemplo:

```bash
cp .env.template .env
```

Configurar las variables necesarias:

```env
DATABASE_URL=
PORT=3000
```

> El archivo `.env` no se versiona.

---

# Base de datos

La aplicación utiliza PostgreSQL mediante Prisma.

## Generar cliente Prisma

```bash
pnpm run db:generate
```

## Aplicar esquema

```bash
pnpm run db:push
```

---

# Autenticación

La API usa login con JWT, manteniendo la whitelist por IP como primera capa de acceso.

Roles y permisos:

* `ADMIN`: lectura y escritura en toda la aplicación.
* `USER` con `READ`: acceso de solo lectura.
* `USER` con `WRITE`: lectura y acciones de escritura habilitadas.

Crear o actualizar el primer administrador:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='cambiar-esta-clave' pnpm run seed:admin
```

In Docker, the API runs this bootstrap automatically at startup when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are present in `.env`.

Endpoints principales:

* `POST /auth/login`
* `POST /auth/register`
* `GET /auth/me`
* `GET /admin/users` (`ADMIN`)
* `PUT /admin/users/:id` (`ADMIN`)
* `DELETE /admin/users/:id` (`ADMIN`)

El frontend incluye un panel `/admin` visible solo para usuarios `ADMIN`, desde donde se pueden ver usuarios, cambiar rol/permisos, activar/desactivar cuentas y eliminar usuarios.

Después de modificar `prisma/schema.prisma`, ejecutar:

```bash
pnpm run db:generate
```

---

# Ejecución

## Desarrollo

```bash
pnpm run start:dev
```

## Producción con Docker

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

## Producción sin Docker

```bash
pnpm run build
pnpm run start:prod
```

---

# Pruebas

## Unitarias

```bash
pnpm test
```

## Integración (E2E)

```bash
pnpm run test:e2e
pnpm run test:e2e -- test/vuln-sync.e2e-spec.ts
```

## Sync resiliente (specs clave)

```bash
pnpm test -- date-range.util.spec
pnpm test -- nvd.collector.spec
pnpm test -- osv.collector.spec
pnpm test -- sync-recovery.service.spec
```

---

# Sincronización resiliente

## Vuln Monitor

Cada fuente guarda watermark en `vuln_sync_state.lastSyncAt` (hasta qué fecha se sincronizó la data).

| Fuente | Recuperación post-caída |
|--------|-------------------------|
| NVD | Ventanas de 90 días (`lastModStartDate`/`lastModEndDate`), checkpoint por chunk |
| GitHub / OSV | Incremental por fecha; OSV checkpoint cada 200 IDs |
| KEV / EPSS | Full refresh periódico |

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/sync/status` | Estado por fuente |
| POST | `/sync/trigger` | Sync incremental manual (requiere write) |
| POST | `/sync/backfill` | Backfill por fecha: `{ source, since, until? }` |

Fuentes de backfill: `nvd`, `github`, `osv`, `kev`. Rango explícito `until` limitado a 365 días.

## Ransomware

El cron cada 30 min usa `/victims/recent` (no exhaustivo). Tras caída prolongada:

- Al boot, si `lastSync` > `RANSOMWARE_RECOVERY_STALE_HOURS` (default 24h), corre sync completo por país + grupos.
- Manual: `POST /data-sources/recover` (requiere write).
- Sync detalle de grupos: `POST /data-sources/sync-groups` (requiere write) — corre en background vía `syncGroupsData`; progreso en `GET /data-sources/sync-groups/status` (`processed/total`); la UI de Grupos consulta `GET /dashboard/sources` (`ransomware-live.lastSync`) para última sync.

Variables en `.env`:

```env
RANSOMWARE_RECOVERY_STALE_HOURS=24
RANSOMWARE_RECOVERY_ON_BOOT=true
```

### Checklist pre-deploy

- [ ] `pnpm test` y `pnpm run test:e2e -- test/vuln-sync.e2e-spec.ts` en verde
- [ ] `pnpm run build` backend + front
- [ ] `POST /sync/trigger` responde `{ started: true, ... }` sin cambios de shape
- [ ] Simular caída NVD: `lastSyncAt` viejo en DB → próximo sync consulta ventana amplia
- [ ] Simular caída ransomware: `lastSync` > 24h → log de recovery al boot

---

# Alertas de vulnerabilidades (perfiles)

Flujo: **perfil de inventario** → **suscripción vuln-monitor** → **preview** → cron cada 5 min matchea CVEs contra paquetes/CPE del perfil.

## Perfiles (`VulnWatchProfile`)

Inventario reutilizable por usuario (App / IT / OT). Cada item define un término de match (`query`) y opcionalmente `vendor`, `product`, `ecosystem`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/alerts/vuln-profiles` | Lista perfiles del usuario (+ items) |
| POST | `/alerts/vuln-profiles` | Crear perfil |
| PUT | `/alerts/vuln-profiles/:id` | Editar |
| DELETE | `/alerts/vuln-profiles/:id` | Borrar (cascade items) |
| POST | `/alerts/vuln/preview` | Preview: `{ profileIds, severities?, days?: 7, ... }` |

## Suscripción `vuln-monitor`

Settings en `AlertSubscription.settings`:

- `profileIds` (obligatorio, ≥1) — OR entre perfiles
- `severities` — default `CRITICAL`, `HIGH`
- Opcional: `cvssMin`, `epssMin`, `isKevOnly`, `keywords` (AND con match de perfil)

El processor (`handleVulnMonitorAlerts`) usa `matchCveToProfiles` sobre `affectedPackages`, CPE NVD y título KEV. Telegram incluye perfil, item, paquetes afectados y link a `/vuln-monitor`.

### Ejemplo perfil OT

```json
{
  "name": "Planta OT Línea 1",
  "environment": "OT",
  "items": [
    { "label": "Siemens S7", "query": "s7", "vendor": "siemens", "product": "s7" }
  ]
}
```

### Checklist utilidad pre-deploy

- [ ] Crear perfil "Stack web" con `nginx`, `postgresql`
- [ ] Preview muestra CVEs recientes que matchean
- [ ] Crear suscripción → `POST /alerts/trigger-manual-check` → Telegram con perfil + producto
- [ ] CVE Critical genérico sin match de perfil → no llega
- [ ] `pnpm test -- alerts/vuln` en verde

---

# Docker

## Entorno estándar

```bash
docker compose up -d --build
```

## Entorno producción

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

---

# Estructura del proyecto

```text
src/
├── modules/
│   ├── actors/
│   ├── alerts/
│   ├── countries/
│   ├── cyber-news/
│   ├── dashboard/
│   ├── data-sources/
│   ├── fake-news/
│   ├── health/
│   ├── ransomware/
│   └── vuln-monitor/
│
├── shared/
│
├── app.controller.ts
├── app.module.ts
├── app.service.ts
└── main.ts

prisma/
libs/
scripts/
test/
storage/
```

---

# Módulos principales

* Actors
* Alerts
* Countries
* Cyber News
* Dashboard
* Data Sources
* Fake News
* Health
* Ransomware
* Vulnerability Monitor

---

# Archivos importantes

## src/main.ts

Punto de entrada de la aplicación.

## src/app.module.ts

Módulo principal del sistema.

## prisma/*

Configuración del esquema y acceso a la base de datos.

## src/modules/*

Implementación de los distintos módulos de negocio.

## src/shared/*

Componentes y utilidades compartidas.

## scripts/*

Scripts auxiliares para mantenimiento e importación de datos.

---

# Convenciones del proyecto

## Gestión de dependencias

Utilizar siempre:

```bash
pnpm
```

No utilizar:

```bash
npm
```

ni

```bash
yarn
```

para evitar inconsistencias en el lockfile.

## Variables de entorno

Toda configuración sensible debe declararse mediante variables de entorno.

No versionar:

```text
.env
```

## Estilo de código

* TypeScript estricto.
* Arquitectura modular de NestJS.
* Prisma como capa de acceso a datos.
* Servicios para lógica de negocio.
* Controladores únicamente para exposición de endpoints.

---

# Flujo de trabajo Git

## Rama principal de desarrollo

Todos los cambios deben realizarse sobre la rama:

```bash
develop
```

Flujo habitual:

```bash
git checkout develop

git pull origin develop

git add .

git commit -m "Descripción del cambio"

git push origin develop
```

## Despliegue

La rama `develop` es utilizada como rama principal de desarrollo.

Una vez validados los cambios, el despliegue a los entornos correspondientes se realiza mediante los pipelines de CI/CD configurados para el proyecto.

No realizar cambios directamente sobre los servidores de producción.

## Buenas prácticas

* Mantener la rama `develop` actualizada antes de comenzar a trabajar.
* Realizar commits descriptivos y pequeños cuando sea posible.
* Verificar que la aplicación compile correctamente antes de realizar un push.
* Evitar commits con archivos temporales, credenciales o archivos `.env`.

```
```
