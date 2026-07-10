# Self-hosted deployment

This guide runs the full stack (Postgres, backend API, frontend) with a single
`docker compose` command. It expects the backend and frontend repos cloned as
sibling directories.

## 1. Layout

```
cogni-threat-back/             <- this repo
├── docker-compose.selfhost.yml
├── .env
cogni-threat-front/            <- sibling clone
```

Clone both repos next to each other:

```bash
git clone https://github.com/<your-account>/cogni-threat-back.git
git clone https://github.com/<your-account>/cogni-threat-front.git
```

## 2. Configure environment

From inside `cogni-threat-back/`:

```bash
cp .env.template .env
```

Fill in the required values in `.env`:

- `DB_PASSWORD` — Postgres password.
- `JWT_SECRET` — random string (`openssl rand -base64 32`).
- `SECRETS_MASTER_KEY` — AES-256-GCM key for the admin secrets panel (`openssl rand -base64 32`).
- `CORS_ORIGIN` — the public URL the frontend will be served from.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — bootstraps the first admin user on first boot.

Everything else (NVD, ransomware.live, Telegram, Ollama) is optional at boot —
you can leave those blank and configure them later from the admin panel
(`/admin/secrets`) once the app is running. See the "AI / RAG" section in
`README.md` for how to point `OLLAMA_URL` at your own Ollama instance instead
of running one locally.

## 3. Run

```bash
docker compose -f docker-compose.selfhost.yml up -d --build
```

This starts:

- `postgres` (with pgvector, used by the AI/RAG module)
- `cogni-threat-api` on `${API_PORT:-3000}`
- `cogni-threat-front` on `${FRONT_PORT:-80}`

Check the API is healthy:

```bash
curl http://localhost:${API_PORT:-3000}/health
```

## 4. Telegram monitoring (optional)

To monitor Telegram channels you need a `TELEGRAM_SESSION_STRING`. Generate one
interactively (asks for your phone number and the code Telegram sends you):

```bash
pnpm install
pnpm run telegram:auth
```

Copy the printed `TELEGRAM_SESSION_STRING` into your `.env` (or into the admin
secrets panel) alongside `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from
https://my.telegram.org.

## 5. Updating

```bash
git pull
docker compose -f docker-compose.selfhost.yml up -d --build
```
