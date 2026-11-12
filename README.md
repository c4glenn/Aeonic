# Todo Tool

Self-hosted, API-first planner: a 7-day board, project cards with dependency-aware subtasks, tags, importance and hard/soft due dates. The web UI is just a client of the public API (`/api/docs`).

## Run
```
pnpm install
cp .env.example .env
pnpm --filter @todo/api hash-password 'your-password'   # paste output into ADMIN_PASSWORD_HASH
pnpm dev                                                 # web :5173, api :3000
```
Production: `docker compose up --build` (data lives in the `todo-data` volume; put it behind a TLS reverse proxy).

## API
Create a token in Settings, then `curl -H "Authorization: Bearer <token>" https://host/api/v1/week`.
Docs: `/api/docs` · Spec: `/api/openapi.json` · Live events: `GET /api/v1/events` (SSE) · Webhooks: Settings.
Set `TZ` on the server (used for the API's notion of "today"); the web UI uses the browser's timezone.
