# Cruise Prepare — build brief (paste into Cursor)

You are picking up an existing, working project. Read this fully before changing code.

## What it is
A family cruise **outfit + packing planner** web app. Domain purchased: **cruiseprepare.com**.
Right now it's loaded with one real trip (Lillian & Ava's quinceañera cruise — Royal
Caribbean *Icon of the Seas*, Miami round-trip, July 16–25 2026), but the intent is to
generalize it so it can handle any cruise.

## Current status — it runs and persists
- Single-page app (`index.html`, **no build step**, vanilla JS) served by a small
  **Node/Express** backend (`server.js`) that persists each **household** plan to
  **Postgres**.
- **Username/password sessions** (cookie). Create a household, share a short
  **invite code** so a spouse joins with their own login; both edit the same plan.
  Kids are **people chips**, not accounts.
- Runs locally via **Docker Compose** (app + Postgres). Verified working end-to-
  end at `localhost:8080`.
- Three tabs: **Today**, **Outfits**, **Packing**. Export/Import JSON backup.

## Architecture
- **Frontend:** one `index.html`, vanilla JS, `localStorage` used only as a
  **cache** (keyed by household id). All plan state lives in a single object `S`.
  Auth gate: lander (create / join / login) until `GET /api/me` succeeds.
- **Backend:** Express + `cookie-session` + `bcryptjs`. Session holds `userId`.
  Plan routes are session-scoped (`GET/PUT /api/plan`). Postgres via `pg` Pool;
  in-memory store fallback when `DATABASE_URL` is unset.
- **Source of truth = Postgres.** Browser cache + last-write-wins by timestamp
  `S._t`. On load: `cloudPull`; on every change: debounced `cloudPush`.
- **Data model:** `users`, `households` (with `invite_code`), `household_members`
  (one household per user in v1), `plans(household_id, data jsonb, updated_at)`.
  The entire plan is still one JSON blob per household.

## State shape (`S`)
```
{
  v: 2,
  people: ["Me"], active: 0,
  outfits: { "person|dayIndex|slot": { t: "text", d: packedBool } },
  labels: {}, formal: { 3:true, 7:true }, notes: {},
  packed: { "person|section|itemIndex": count },
  need:   { "person|section|itemIndex": qty },
  custom: { "person|section": ["extra item", ...] },
  deadlines: [ { date:"YYYY-MM-DD", label, done } ],
  _t: 1234567890
}
```
- Packing items in `CHECKLISTS` are either `"Name"` (single checkbox, qty 1) or
  `["Name", qty]` (counted stepper). `DAYS` is the itinerary; port days carry an
  `aboard` time. Keys are joined with `|`.

## Files
```
index.html          # the whole app (single file, vanilla JS) + lander
server.js           # Express: auth, households, plan API (conditional SSL, pool error handler)
schema.sql          # users, households, household_members, plans
package.json        # express + pg + bcryptjs + cookie-session
Dockerfile          # node:20-alpine
docker-compose.yml  # app (web) + postgres (db); DATABASE_URL + SESSION_SECRET
.do/app.yaml        # DigitalOcean App Platform spec
README.md
```

## Run it
```
docker compose up --build    # → http://localhost:8080  (real Postgres)
# or, quick UI-only (in-memory, resets on restart):
npm install && npm start
```

## Decisions to preserve (do NOT quietly undo)
- localStorage is a **cache**; the server/Postgres is authoritative.
- **Conditional SSL** in `server.js`: local (`localhost` / `sslmode=disable`) → SSL off;
  managed DB (DigitalOcean) → `ssl: { rejectUnauthorized: false }`. Keep this.
- The `pg` Pool has an **error handler** so a dropped/idle connection can't crash the
  process. Keep this.
- Identity is **username/password + household invite code** (not sync codes). Google
  Auth is deferred. Set `SESSION_SECRET` in production.
- Hosting target: **DigitalOcean App Platform + Managed Postgres**, one Node service.
  Domain `cruiseprepare.com` stays at **GoDaddy**, pointed at DO.

## Roadmap (build next, roughly in order)
1. **Trip Info tab** (4th tab): confirmation numbers, port board, budget/gratuities,
   editable deadlines under `S.tripInfo`. Keep mobile-first nav to ~4 tabs.
2. **Generalize beyond the hardcoded trip:** trip config object so any cruise works.
3. **Google Auth** (optional) alongside password; same household/invite model.
4. **Shared trips across households** (optional): shared itinerary/events while each
   household's outfits/packing stay private.
5. **Deploy:** GitHub → DO App Platform + Managed Postgres → custom domain.

## Conventions / gotchas
- No framework, no bundler — keep `index.html` self-contained vanilla JS unless you make a
  deliberate, discussed decision to introduce a framework.
- `esc()` escapes HTML; `hash()` makes stable element ids.
- **Express 4** (`app.get('*')` catch-all). Express 5 changes the `'*'` route syntax — if you
  upgrade, update that route.
- Node 20 in Docker; `package.json` engines `>=18`.
- Minor cleanup: `README.md`'s "Run it locally" section may be a slightly older copy —
  refresh it to match the Docker-first instructions if you touch it.

## Suggested first task
Ship household auth to family: Create → share invite → spouse joins → both manage
people chips (kids). Then Trip Info tab.
