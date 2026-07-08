# Cruise Prepare

A family cruise outfit & packing planner. Single-page app served by a tiny
Node/Express backend. Adults create a **household**, invite a spouse with a
short code, and share one plan (kids are people chips, not accounts). Data
lives in Postgres; the browser is only a cache.

Live home: **cruiseprepare.com** (DigitalOcean App Platform + Managed Postgres)

## Run it locally with Docker (recommended)

```bash
docker compose up --build
# open http://localhost:8080
```

Data persists in the `pgdata` volume across restarts. Stop with `Ctrl-C`;
`docker compose down` stops it, `docker compose down -v` also wipes the data.

## Run it locally without Docker

```bash
npm install
npm start
# open http://localhost:8080
```

With no `DATABASE_URL` set, the server uses an in-memory store — fine for quick
UI work, but data resets on restart. For a real database, set `DATABASE_URL`
(and preferably `SESSION_SECRET`) before `npm start`.

## Accounts & households

1. **Create household** — username, password, household name. You become the owner and get a 6-character **invite code**.
2. **Join** — spouse signs up with that invite code (their own username/password) and shares the same plan.
3. **Log in** — same credentials on any device.
4. Add kids (and adult names for lists) with the **+ Add person** chips.

Kids never need accounts. Both adults can edit everyone’s outfits and packing.

## How data is stored

- The browser is a **cache**; the server is the source of truth.
- Session cookie identifies the signed-in user; the plan is keyed by **household**.
- API (all require a signed-in session except auth routes):
  - `POST /api/auth/signup` · `POST /api/auth/join` · `POST /api/auth/login` · `POST /api/auth/logout`
  - `GET /api/me`
  - `GET /api/plan` · `PUT /api/plan` with `{ data }`
- Tables: see `schema.sql` (`users`, `households`, `household_members`, `plans`).

Set `SESSION_SECRET` in production. Cookies use `secure` when `NODE_ENV=production`.

## Project layout

```
cruiseprepare/
├── index.html      # the app (single file, no build step)
├── server.js       # Express: auth, households, plan API, static app
├── schema.sql      # Postgres tables
├── package.json
├── docker-compose.yml
├── .do/app.yaml    # DigitalOcean App Platform spec (optional)
└── README.md
```

## Deploy to DigitalOcean

1. Create an **App** from your GitHub `cruiseprepare` repo.
2. Run command `npm start`, HTTP port `8080`.
3. Attach **Managed Postgres**; inject `DATABASE_URL`.
4. Set secrets: `SESSION_SECRET` (long random string), `NODE_ENV=production`.
5. Point `cruiseprepare.com` DNS at the app (HTTPS is automatic).
