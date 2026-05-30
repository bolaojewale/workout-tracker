# BJ Workout Tracker

A personal, mobile-first (PWA) workout tracker that pre-fills each session from
last time with a suggested progression, lets you edit sets live at the gym, and
charts your progress weekly and monthly. Self-hosted on Cloudflare.

See **[DESIGN.md](./DESIGN.md)** for the full design and data model.

## Stack
- **Frontend:** Vite + TypeScript PWA (installable, offline-capable) → `web/`
- **API:** Cloudflare Worker (Hono) → `api/`
- **Data:** Cloudflare D1 (SQLite) → `migrations/`
- **Photos:** Cloudflare R2
- **Shared types:** `shared/`

## Develop locally
```bash
npm install

# Terminal 1 — Worker + local D1
npm run db:migrate:local      # apply migrations to the local D1
npm run dev                   # wrangler dev on :8787 (serves /api + built assets)

# Terminal 2 — frontend with hot reload (proxies /api to :8787)
npm run dev:web               # vite on :5173
```

Type-check everything: `npm run typecheck`.

## Deploy to Cloudflare
```bash
# One-time provisioning
wrangler d1 create workout_tracker          # paste database_id into wrangler.toml
wrangler r2 bucket create workout-photos
wrangler secret put SESSION_SECRET
wrangler secret put RP_ID                   # your domain
wrangler secret put ORIGIN                  # https://your-domain

npm run db:migrate                          # apply migrations to remote D1
npm run deploy                              # build web + deploy Worker
```

## Status
Steps 1–4 done (see DESIGN.md §10):
- Scaffold: PWA shell + Worker + D1 schema
- Single-user auth (PBKDF2 + signed cookies), starter exercise seed
- Exercises & Routines CRUD + screens
- Session logging with the progression engine; offline logging + sync queue

Next: progress dashboards (step 5), then weekly/monthly summaries + photos (step 6).
