# CLAUDE.md

## 1. Overview
Self-hosted, API-first planner. The web UI is one client of a public REST API so the owner's other tools can integrate.

Main view: a 7-day strip (today + 6) with project cards below. Each card lists its **unblocked** subtasks as draggable items; dropping one on a day opens "What are you planning on doing?" with a *whole subtask* option or a text field that creates a new child subtask.

Core domain rules (live only in `packages/domain`):
- **Scheduling a subtask unlocks its dependents.** A task is unblocked when every blocker is scheduled or done.
- Subtasks have an optional **hard due** and **soft due** date, plus importance (1-4) and tags.
- **Urgency** = days until the soonest due date (hard or soft) among the task and all its transitive dependents. Hard wins ties; overdue sorts first.
- Dependencies must stay acyclic.
- Dates are plain `YYYY-MM-DD` strings. Never use `Date` for storage.
- **Timed blocks:** a scheduled task may also have `startTime` (`HH:MM` wall clock, no timezone) and `durationMinutes` (5–1440, default 30, must end by midnight). Omitting the time on a schedule call makes the task untimed; unscheduling clears both.
- **ICS calendars** are read-only subscriptions. Events are UTC instants (timed) or `YYYY-MM-DD` with an *exclusive* end (all-day); the browser clips them to its own local days.

## 2. Setup
Requires Node 20 and pnpm 10.

```
pnpm install
cp .env.example .env     # ADMIN_PASSWORD_HASH (pnpm --filter @aeonic/api hash-password '<pw>'), SESSION_SECRET, DATABASE_PATH, CORS_ORIGINS, TZ
pnpm db:migrate
pnpm dev                 # api + web
pnpm test                # vitest (domain + api)
pnpm e2e                 # playwright (desktop + 390px mobile)
pnpm lint && pnpm typecheck && pnpm build
pnpm client:generate     # regenerate packages/client from OpenAPI
docker compose up --build
```
Add UI components with `pnpm dlx shadcn@latest add <name>`.

## 3. Architecture
```
apps/api          Hono + @hono/zod-openapi + SQLite (better-sqlite3, Drizzle); REST, SSE, serves web build
apps/web          Vite + React + TanStack Query; talks only to the public API
packages/domain   Pure TS: types, zod schemas, unblock/urgency/sort/filter/cycle logic
packages/client   Typed client generated from the OpenAPI spec
```
- Business rules go in `packages/domain` only. The API returns computed fields (`unblocked`, `urgency`); the UI must not re-implement them.
- `apps/web` uses `packages/client` for all data access.
- Passwords use scrypt (node:crypto, no native deps). Tags are free-form strings derived from usage (no tag table). Schema changes are append-only SQL in `apps/api/src/db/migrate.ts` and must be mirrored in `db/schema.ts`.
- Live events are at `GET /api/v1/events` (SSE).
- Every endpoint is zod-typed so `/api/openapi.json` stays complete. Changes within `/api/v1` are additive.

## 3b. Calendars and the hour grid
- `apps/api/src/ics.ts` (fetch, parse via node-ical, expand recurrences/EXDATE/moved occurrences) and `calendars.ts` (cache + periodic refresh, `ICS_REFRESH_MINUTES`, default 30). The raw ICS is stored in SQLite; parsed events are cached in memory.
- **Never return a calendar's full URL** (it usually embeds a secret token) — only the host.
- The API fetches user-supplied http(s) URLs (webcal:// is rewritten to https://). This is an SSRF surface; it is acceptable only because the API is single-user and authenticated. Don't expose it to untrusted users without an allowlist.
- Week view = day cards (untimed tasks, due markers, all-day events; drop target `id=<date>`) + hour grid (`HOUR_PX=48`, droppable `id=time:<date>`, 15-min snap). Resize uses plain pointer events on the block's bottom handle (not dnd-kit) and arrow keys.
- **Drop time must come from the live pointer position** (tracked in `App.tsx`), never dnd-kit's `delta`, which includes auto-scroll compensation. The grid only auto-scrolls while the pointer is inside it (`data-autoscroll="pointer"`).
- Overlap layout and snapping live in `packages/domain/src/time.ts` (`layoutOverlaps`, `clampBlock`).

## 3c. Now banner
- `GET /api/v1/now?tz=&at=` → `{ now, current, next }` (`apps/api/src/now.ts`, pure `computeNow`). Only items with clock times count: timed tasks (wall-clock read in `tz`, default server `TZ`) and timed calendar events. Untimed tasks, all-day events and done tasks are ignored. `current` = contains now (soonest-ending if several); `next` = next to start (up to 14 days ahead), also returned while something is current.
- The header banner (`features/now/NowBanner.tsx`, wording in `lib/now.ts`) says `Current task|event: “…” ends at h:mm (h:mm left)` or `Upcoming task|event: “…” starts at h:mm (h:mm away)`. The state word and noun are always spelled out; icon/styling only reinforce them. It passes the browser's zone as `tz`, refreshes on SSE events and every minute, and refetches when the clock crosses the item's boundary.
- Task wall-clock → instant conversion is `zonedToInstant` in `packages/domain/src/dates.ts` (DST-safe).

## 4. API conventions
- JSON, RFC 9457 problem-details errors, cursor pagination.
- `Idempotency-Key` honored on POST; ETag / `If-Match` on PATCH.
- Auth: `Authorization: Bearer <token>` (hashed, scoped `read`/`write`) or session cookie for the web UI.
- Scheduling a blocked task returns 409 with the blockers; dependency cycles return 422.
- Webhook events: `task.created|updated|scheduled|completed`, `project.*`, HMAC-signed.

## 5. Component policy
- Use **shadcn/ui (Radix)** and **lucide-react** first. Wrap rather than fork. Write a custom component only when nothing suitable exists. Don't add another UI library without asking.
- Drag and drop uses `@dnd-kit` (pointer, touch, keyboard sensors).

## 6. Style guide
**Theme:** dark only. Dracula-inspired violet-black surfaces (~`#1e1b2e`, `#282440`), lavender text, purple primary (~`#a78bfa` / `#bd93f9`).
- All colors come from CSS tokens in `apps/web/src/styles/theme.css` (Tailwind v4 `@theme`). **No hard-coded hex in components.**
- Accents use the Okabe-Ito set (blue `#56B4E9`, orange `#E69F00`, yellow `#F0E442`, bluish-green `#009E73`, vermillion `#D55E00`, pink `#CC79A7`), tuned for dark. Never use red/green as a meaning pair.
- **Never encode meaning with color alone.**
  - Hard due: solid thick border + flag icon + "Due"
  - Soft due: dashed border + hourglass icon + "Target" (lighter weight)
  - Weekend: tint + diagonal hatch + different header style
  - Calendar event: dotted fill (`.event-surface`) + colored stripe + calendar icon + calendar name; always read-only. Tasks are solid fills.
  - Importance: icon/bar count + label
  - Locked: lock icon
- WCAG AA contrast (4.5:1 text, 3:1 UI). Check with axe and a CVD simulator (deuteranopia, protanopia, tritanopia).

**Avoid the generic AI look:** no gradient blobs, glassmorphism, emoji as icons, or default shadcn zinc left untouched. Use a distinctive self-hosted type pair (a characterful display face such as Bricolage Grotesque or Space Grotesk, with Geist or Inter for UI), 1px crisp borders, a tight spacing grid, and restrained motion (<=150ms, honor `prefers-reduced-motion`).

## 7. Mobile and accessibility
- Touch targets >= 44px. Test at 390px width.
- Drag activates on 200ms long-press so scrolling works. Every chip also has a "Schedule…" tap action with a day picker. Drag is never the only path.
- Everything is keyboard operable, with visible focus rings.
- Week strip is sticky and scroll-snaps horizontally on mobile.

## 7b. Testing gotchas
- `pnpm e2e` runs a tiny ICS feed (`e2e/ics-server.mjs`, port 3102) and the API on 3101 with a throwaway DB. Specs share one DB and run in file order, so create your own data through the API and filter to it with `/?projects=<id>` before dragging.
- dnd-kit needs real pointer movement: drag in steps, and aim at the middle of the hour grid (edges auto-scroll).
- Radix dialogs set `aria-hidden` on the page behind them, so `getByRole` can't see it — query the DOM instead.
- `packages/client` generation needs TypeScript 5.x (it is pinned there); the web app uses TS 7.

## 8. Conventions
- TypeScript strict, no `any`, small focused files.
- Add tests with every domain or API change (domain unit tests first).
- Conventional commits.
- Never commit secrets, `.env`, or the SQLite database file.
