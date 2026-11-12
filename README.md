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

## Calendars
Settings → Calendars: paste an ICS link (`https://…` or `webcal://…`) from Google, Apple, Outlook, Nextcloud, etc. Events appear read-only in the Week (hour grid + all-day row), List, Month and Gantt views and refresh every `ICS_REFRESH_MINUTES`. Treat the link like a password; it is stored server-side and never returned by the API.

## Hour grid
In the Week view, drop a task on a day's hour grid to create a 30-minute block, then drag its bottom edge (or use ↑/↓) to change the length in 15-minute steps. Drag blocks to move them; drop on the day card to make a task untimed again.
