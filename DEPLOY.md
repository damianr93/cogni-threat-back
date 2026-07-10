# Self-hosted deployment

This guide runs the full stack (PostgreSQL + pgvector, backend API, frontend)
with a single `docker compose` command. It expects this repo and the
[frontend repo](https://github.com/damianr93/cogni-threat-front) cloned as
sibling directories — the backend's `docker-compose.yml` builds the frontend
from `../cogni-threat-front`.

## 1. Layout

```
cogni-threat-back/              <- this repo
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env
cogni-threat-front/             <- sibling clone
```

```bash
git clone https://github.com/damianr93/cogni-threat-back.git
git clone https://github.com/damianr93/cogni-threat-front.git
```

## 2. Configure environment

From inside `cogni-threat-back/`:

```bash
cp .env.template .env
```

Fill in the required values:

- `DB_PASSWORD` — Postgres password.
- `JWT_SECRET` — random string (`openssl rand -base64 32`).
- `SECRETS_MASTER_KEY` — AES-256-GCM key for the admin secrets panel (`openssl rand -base64 32`).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — bootstraps the first admin user on first boot.

Everything else (NVD, ransomware.live, Telegram, Ollama) is optional at boot —
leave those blank and configure them later from the admin panel
(`/admin/secrets`) once the app is running.

## 3. Run

```bash
docker compose up --build
```

This starts:

- `postgres` (pgvector, used by the AI/RAG module) on `${DB_PORT:-5433}`
- `cogni-threat-api` on `${API_HOST_PORT:-3000}`
- `cogni-threat-front` on `${FRONT_PORT:-8080}`

Check the API is healthy, then open the frontend and sign in with your
`ADMIN_EMAIL` / `ADMIN_PASSWORD`:

```bash
curl http://localhost:${API_HOST_PORT:-3000}/health
```

For a hardened production profile (no exposed DB port, stricter required
vars), use `docker-compose.prod.yml` instead — see the comments in that file.

## 4. AI provider (Ollama)

CogniThreat uses Ollama by default so the whole stack stays self-hosted with
no paid API keys required. `OLLAMA_URL`, chat model, and embedding model are
configurable from **Administración → Fuentes, credenciales e IA** once the
app is running — no restart needed. `EMBEDDING_DIM` must stay in `.env`
because it has to match the vector dimension stored in pgvector; changing it
after data exists requires reindexing.

**Networking gotcha:** if Ollama runs on your host machine (installed
natively, not as a container) and the API runs inside Docker, `localhost`
inside the container refers to the container itself, not your host. Use
`http://host.docker.internal:11434` instead — this is already the default in
`.env.template`, and `docker-compose.yml`/`docker-compose.prod.yml` map that
hostname for you (works out of the box on Docker Desktop for macOS/Windows;
on Linux it requires Docker 20.10+, which the compose files already account
for via `extra_hosts`). If you run Ollama as its own container on the same
Docker network instead, point `OLLAMA_URL` at that container's service name.

## 5. Telegram monitoring (optional)

To monitor Telegram channels you need `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`
(from https://my.telegram.org) plus a `TELEGRAM_SESSION_STRING`.

**From the admin panel (recommended):** go to **Administración → Fuentes,
credenciales e IA**, save `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` first —
the "Conectar cuenta de Telegram" phone-login flow reads those from the
secrets panel, not from `.env`, so it will refuse to start until they're
saved there.

**From the CLI (alternative):** generate the session string interactively
(asks for your phone number and the code Telegram sends you) and paste the
result into `.env` or the admin panel:

```bash
pnpm install
pnpm run telegram:auth
```

Copy the printed `TELEGRAM_SESSION_STRING` into your `.env` (or into the
admin secrets panel) alongside `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from
https://my.telegram.org.

## 6. Updating

```bash
git pull
docker compose up -d --build
```
