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

## Branching

Two kinds of branch, and the branch name is the whole deploy story:

| Branch | What a push does | Where it lands |
| --- | --- | --- |
| `main` | `wrangler deploy` | production — <https://workouts.bolaojewale.com> |
| anything else | `wrangler versions upload` | a per-push preview URL on `workers.dev` |

Cloudflare **Workers Builds** watches the repo and runs those commands itself, so
a push (or a merged PR) is the deploy. Nothing is deployed from a laptop.

A preview URL looks like `https://<version-prefix>-workout-tracker.<subdomain>.workers.dev`
and is printed in the build log and on the Worker's Versions tab. It's a new URL
every push, and it never takes production traffic.

Work on a branch, open a PR, test the preview on your phone, merge to `main`.

### Previews share the production database
Preview builds use the **same D1 database and secrets as production** — that's
deliberate (a preview shows your real workout history), but it means a dev branch
can write real data. Two consequences:

- Preview URLs are publicly reachable; the app's password login is what guards
  them. Cloudflare Access can lock them down further if that's not enough.
- **Migrations are not automatic.** Before merging a PR that adds a file to
  `migrations/`, apply it yourself:

  ```bash
  npm run db:migrate      # wrangler d1 migrations apply --remote
  ```

  Deliberately left out of the build so no branch can reshape the live schema
  on its own.

## Deploy to Cloudflare

Routine deploys need no commands — see **Branching** above.

For reference, the one-time provisioning (already done for this account) was:

```bash
wrangler d1 create workout_tracker          # paste database_id into wrangler.toml
wrangler r2 bucket create workout-photos
wrangler secret put SESSION_SECRET
```

`npm run deploy` still works as a manual escape hatch if Workers Builds is ever
unavailable. To undo a bad deploy, use Versions → Rollback in the dashboard.

## Status
Deployed and in daily use at <https://workouts.bolaojewale.com>.

All roadmap steps done (see DESIGN.md §10):
- Scaffold: PWA shell + Worker + D1 schema
- Single-user auth (PBKDF2 + signed cookies), starter exercise seed
- Exercises & Routines CRUD + screens
- Session logging with the progression engine; offline logging + sync queue
- Progress dashboards (per-exercise est-1RM, bodyweight, volume, running pace)
- Weekly & monthly summaries (sheet-style) + monthly check-ins
- Progress photos, stored in R2 (`api/photos.ts`)
