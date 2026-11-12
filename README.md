# Aeonic

Self-hosted, API-first planner: a 7-day board, project cards with dependency-aware subtasks, tags, importance and hard/soft due dates. The web UI is just a client of the public API (`/api/docs`).

## Run
```
pnpm install
cp .env.example .env
pnpm --filter @aeonic/api hash-password 'your-password'   # paste output into ADMIN_PASSWORD_HASH
pnpm dev                                                 # web :5173, api :3000
```
## Deploy
`docker-compose.yml` needs **no `.env` file** — configuration comes from environment variables, so it works from a plain git checkout (Portainer "Repository", `docker compose up`, etc.). Data lives in the `aeonic-data` volume; put the container behind a TLS reverse proxy.

| Variable | Required | Notes |
| --- | --- | --- |
| `ADMIN_PASSWORD_HASH` | yes | Hash of the web login password (below) |
| `TZ` | no (`UTC`) | Server time zone, e.g. `Europe/London`. Used for the API's idea of "today" and for calendar events with floating times |
| `PORT` | no (`3000`) | Host port to publish |
| `ICS_REFRESH_MINUTES` | no (`30`) | How often calendar links are re-downloaded |
| `SESSION_SECRET`, `CORS_ORIGINS` | no | Only needed if you call the API from a browser on another origin |

**Make the password hash** (needs only Node, or Docker):
```
node -e "const c=require('crypto');const s=c.randomBytes(16);console.log('scrypt:'+s.toString('hex')+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'your-password'
# or, without Node installed:
docker run --rm node:20-slim node -e "const c=require('crypto');const s=c.randomBytes(16);console.log('scrypt:'+s.toString('hex')+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'your-password'
```
The hash has no `$` in it, so it survives Compose/Portainer variable interpolation. (Older `scrypt$…$…` hashes still work, but `$` must be escaped as `$$` in Compose.)

**Portainer:** Stacks → Add stack → *Repository* → paste the repo URL, compose path `docker-compose.yml` → under *Environment variables* add `ADMIN_PASSWORD_HASH` (and `TZ`) → Deploy. **Plain Compose:** `ADMIN_PASSWORD_HASH='scrypt:…' docker compose up -d --build`, or put the variables in a `.env` next to the compose file.

## API
Create a token in Settings, then `curl -H "Authorization: Bearer <token>" https://host/api/v1/week`.
Docs: `/api/docs` · Spec: `/api/openapi.json` · Live events: `GET /api/v1/events` (SSE) · Webhooks: Settings.
Set `TZ` on the server (used for the API's notion of "today"); the web UI uses the browser's timezone.

## Calendars
Settings → Calendars: paste an ICS link (`https://…` or `webcal://…`) from Google, Apple, Outlook, Nextcloud, etc. Events appear read-only in the Week (hour grid + all-day row), List, Month and Gantt views and refresh every `ICS_REFRESH_MINUTES`. Treat the link like a password; it is stored server-side and never returned by the API.

## Hour grid
In the Week view, drop a task on a day's hour grid to create a 30-minute block, then drag its bottom edge (or use ↑/↓) to change the length in 15-minute steps. Drag blocks to move them; drop on the day card to make a task untimed again.

## Now banner / `GET /api/v1/now`
The header shows what's happening right now (or what's next): `Current task: "Write spec" ends at 10:30 AM (0:25 left)` / `Upcoming event: "Standup" starts at 9:00 AM (1:05 away)`. It covers timed tasks and timed calendar events. The same data is available to your own tools: `curl -H "Authorization: Bearer <token>" "https://host/api/v1/now?tz=Europe/London"`.
