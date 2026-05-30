# BJ Workout Tracker — Design

A personal, mobile-first workout tracker. Log your daily lifts and runs, have
each session pre-filled from last time with a suggested progression, edit sets
in real time at the gym, and watch your progress trend over weeks and months.

Modeled directly on the paper `BJ_Progress_Tracker` sheet, which tracks at three
cadences: **daily** (the session), **weekly** (trends + completed-vs-planned +
top lift progress), and **monthly** (measurements, compound-lift tests, mile
time trial, photos).

---

## 1. Goals & Non-Goals

### Goals
- Log a full training session from a phone, fast, with minimal typing.
- When loading a day's workout, pre-fill each exercise with **last time's
  weight/reps** and a **suggested progression** — fully overridable in real time.
- Reusable **routines/templates** ("Push A", "Leg Day") that instantiate into a
  dated session.
- Track and chart progress: per-exercise strength, bodyweight, weekly volume,
  running pace.
- Auto-generate **weekly** and **monthly** summaries matching the paper sheet.
- Installable **PWA** that works offline at the gym and syncs on reconnect.
- Self-hostable on the user's own **Cloudflare** account.

### Non-Goals (v1)
- Multi-user accounts / social features (single user only).
- Native iOS/Android apps (PWA covers this).
- Nutrition/macro tracking beyond the simple daily fields on the sheet.
- Wearable/Strava integrations (possible later).

---

## 2. Confirmed Decisions

| Area | Decision |
|------|----------|
| **Base logic** | Per-exercise. Loading a session pulls each exercise's most recent logged numbers and suggests a small increase when all target reps were hit last time. Always overridable. |
| **Stack** | Cloudflare Pages (frontend) + Workers (API) + D1/SQLite (data) + R2 (progress photos). |
| **Auth** | Single user. Passkey (WebAuthn) preferred, password fallback. |
| **Mobile** | Installable PWA. Offline logging queued locally and synced when back online. |
| **Per-set weight** | Each set stores its own weight × reps (handles ramp-ups / drop sets). Top weight quick-fills the rest. |
| **Sets per exercise** | Unlimited; routine defaults to 3–5. |
| **Running pace** | Auto-calculated from distance + time. |
| **Units** | lbs / miles (configurable later). |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PWA (Cloudflare Pages)                                       │
│  - App shell + service worker (offline cache + sync queue)    │
│  - IndexedDB: local session draft + outbound mutation queue   │
└───────────────┬───────────────────────────────────────────────┘
                │  HTTPS (JSON), session cookie
                ▼
┌─────────────────────────────────────────────────────────────┐
│  API (Cloudflare Worker)                                      │
│  - Auth (WebAuthn / password), session cookies                │
│  - REST-ish endpoints (see §6)                                │
│  - Progression engine, summary aggregation                    │
└───────┬───────────────────────────────────┬───────────────────┘
        │                                     │
        ▼                                     ▼
┌──────────────────┐                 ┌──────────────────┐
│  D1 (SQLite)     │                 │  R2 (object store)│
│  all structured  │                 │  progress photos  │
│  data            │                 │                   │
└──────────────────┘                 └──────────────────┘
```

- **Frontend:** lightweight SPA (Vite). No heavy framework required; component
  structure kept small. Charts via a small lib (e.g. Chart.js / uPlot).
- **API:** single Worker using a minimal router (Hono). Returns JSON.
- **Offline:** the active session is editable offline. Mutations are written to
  an IndexedDB queue and a service worker replays them to the API on reconnect.
  Each mutation carries a client-generated UUID for idempotency.

---

## 4. Data Model (D1 / SQLite)

```sql
-- A user record exists so auth + future multi-user is clean, but v1 is single user.
user(
  id            TEXT PRIMARY KEY,        -- uuid
  email         TEXT UNIQUE,
  display_name  TEXT,
  units         TEXT DEFAULT 'imperial', -- 'imperial' | 'metric'
  created_at    INTEGER
)

-- WebAuthn credentials and/or password hash.
credential(
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES user(id),
  type          TEXT,                    -- 'passkey' | 'password'
  public_key    BLOB,                    -- passkey
  counter       INTEGER,                 -- passkey signature counter
  password_hash TEXT,                    -- password (argon2/scrypt)
  created_at    INTEGER
)

-- Library of exercises.
exercise(
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES user(id),
  name          TEXT NOT NULL,           -- "Barbell Bench Press"
  kind          TEXT NOT NULL,           -- 'lift' | 'cardio'
  muscle_group  TEXT,                    -- optional, for filtering
  default_sets  INTEGER DEFAULT 3,
  is_favorite   INTEGER DEFAULT 0,       -- "top lifts" dashboard
  unit          TEXT DEFAULT 'lbs',      -- 'lbs' | 'kg' | 'mi' | 'min'
  progression_step REAL DEFAULT 5,       -- suggested increment (lbs)
  archived      INTEGER DEFAULT 0,
  created_at    INTEGER
)

-- Reusable templates.
routine(
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES user(id),
  name          TEXT NOT NULL,           -- "Push A"
  notes         TEXT,
  archived      INTEGER DEFAULT 0,
  created_at    INTEGER
)

routine_exercise(
  id            TEXT PRIMARY KEY,
  routine_id    TEXT REFERENCES routine(id),
  exercise_id   TEXT REFERENCES exercise(id),
  position      INTEGER,                 -- order in the routine
  target_sets   INTEGER DEFAULT 3,
  target_reps   INTEGER,                 -- nullable
  UNIQUE(routine_id, exercise_id)
)

-- One training day.
session(
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES user(id),
  date          TEXT NOT NULL,           -- 'YYYY-MM-DD'
  routine_id    TEXT REFERENCES routine(id),  -- nullable (ad hoc)
  title         TEXT,                    -- "Push A" / freeform
  -- daily metrics (from the sheet)
  body_weight   REAL,                    -- morning weight
  sleep_hours   REAL,
  energy        INTEGER,                 -- 1-10
  mood          INTEGER,                 -- 1-10
  protein_hit   INTEGER,                 -- 0/1
  calories      INTEGER,
  notes         TEXT,
  completed     INTEGER DEFAULT 0,       -- planned vs completed
  created_at    INTEGER,
  updated_at    INTEGER,
  UNIQUE(user_id, date, routine_id)
)

-- An exercise as performed in a session.
session_exercise(
  id            TEXT PRIMARY KEY,
  session_id    TEXT REFERENCES session(id),
  exercise_id   TEXT REFERENCES exercise(id),
  position      INTEGER,
  rpe           REAL                     -- overall RPE for the exercise
)

-- One set. Per-set weight × reps.
set_entry(
  id            TEXT PRIMARY KEY,
  session_exercise_id TEXT REFERENCES session_exercise(id),
  set_number    INTEGER,
  weight        REAL,
  reps          INTEGER,
  rpe           REAL,                    -- optional per-set RPE
  is_warmup     INTEGER DEFAULT 0,
  completed     INTEGER DEFAULT 1
)

-- Optional running block on a session.
run_entry(
  id            TEXT PRIMARY KEY,
  session_id    TEXT REFERENCES session(id),
  distance_mi   REAL,
  duration_sec  INTEGER,
  -- pace derived: duration_sec / distance_mi
  effort        INTEGER,                 -- 1-10
  run_type      TEXT                     -- 'easy'|'tempo'|'intervals'|'long'|'recovery'
)

-- Monthly check-in (measurements, photos, lift tests, mile trial).
checkin(
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES user(id),
  date          TEXT NOT NULL,
  -- body measurements (inches)
  chest REAL, waist REAL, hips REAL, arms REAL, thighs REAL, forearms REAL,
  body_weight   REAL,
  mile_time_sec INTEGER,                 -- 1-mile time trial
  notes         TEXT
)

-- Compound-lift test results captured at a check-in.
checkin_lift(
  id            TEXT PRIMARY KEY,
  checkin_id    TEXT REFERENCES checkin(id),
  exercise_id   TEXT REFERENCES exercise(id),
  weight        REAL,
  reps          INTEGER
)

-- Progress photos stored in R2; metadata here.
photo(
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES user(id),
  checkin_id    TEXT REFERENCES checkin(id),
  r2_key        TEXT,
  angle         TEXT,                    -- 'front'|'side'|'back'
  taken_at      INTEGER
)

-- Idempotency log so replayed offline mutations don't double-apply.
applied_mutation(
  id            TEXT PRIMARY KEY,        -- client-generated uuid
  applied_at    INTEGER
)
```

### Estimated 1RM
For per-exercise strength charts we compute estimated 1RM per set using the
**Epley formula**: `1RM ≈ weight × (1 + reps / 30)`. The exercise's progression
chart plots the best set's est-1RM per session over time.

---

## 5. Progression Engine

When a session is created from a routine, for each exercise:

1. Find that exercise's **most recent prior `session_exercise`** (any session).
2. Read its **best working set** (highest est-1RM, warmups excluded) → base
   `weight` and `reps`.
3. Decide a suggestion:
   - If last time **all target sets met or exceeded target reps** → suggest
     `weight + progression_step` at the target reps ("ready to add weight").
   - Else → repeat the same `weight × reps` ("repeat / build reps first").
4. Pre-fill `target_sets` rows with the suggested numbers, flagged as
   *suggested*. The user edits any field live; edits clear the suggested flag.
5. If there is no history, fields start empty with the routine's target reps.

The suggestion is advisory only — never blocks manual entry.

---

## 6. API Surface (Worker)

All under `/api`, JSON, session-cookie auth. Mutations accept a
`mutationId` (uuid) for idempotent offline replay.

```
POST   /api/auth/register            # first-run: create the single user
POST   /api/auth/passkey/options     # WebAuthn challenge
POST   /api/auth/passkey/verify
POST   /api/auth/login               # password fallback
POST   /api/auth/logout
GET    /api/me

GET    /api/exercises
POST   /api/exercises
PATCH  /api/exercises/:id
DELETE /api/exercises/:id            # soft (archived)

GET    /api/routines
POST   /api/routines
GET    /api/routines/:id
PATCH  /api/routines/:id
DELETE /api/routines/:id

# Create/load a day. If a session for (date, routine) exists, returns it;
# otherwise builds one from the routine + progression engine.
POST   /api/sessions                 # { date, routineId? } -> session w/ prefilled sets
GET    /api/sessions?from=&to=
GET    /api/sessions/:id
PATCH  /api/sessions/:id             # metrics, notes, completed
DELETE /api/sessions/:id

PATCH  /api/session-exercises/:id    # rpe, reorder
POST   /api/session-exercises/:id/sets
PATCH  /api/sets/:id                 # weight, reps, rpe, completed
DELETE /api/sets/:id

PUT    /api/sessions/:id/run         # upsert running block

GET    /api/checkins
POST   /api/checkins
PATCH  /api/checkins/:id
POST   /api/checkins/:id/photos      # presigned R2 upload

# Aggregations
GET    /api/stats/exercise/:id       # est-1RM + volume series
GET    /api/stats/bodyweight         # bodyweight trend
GET    /api/stats/running            # pace trend by type
GET    /api/summary/weekly?week=     # matches the paper weekly summary
GET    /api/summary/monthly?month=   # matches the paper monthly check-in
```

---

## 7. Screens (PWA)

1. **Today** — date picker, pick/create routine, the live session log:
   per-exercise cards with set rows (weight × reps + RPE), suggested values
   pre-filled and greyed until touched, quick "+set" / "+5 lbs" buttons, daily
   metrics collapsible, optional running block, notes. Big tap targets.
2. **Routines** — list, create/edit (pick exercises, order, target sets/reps).
3. **Exercises** — library, mark favorites, set progression step.
4. **Progress** — per-exercise strength chart (favorites first), bodyweight
   trend, weekly volume, running pace trend.
5. **Summaries** — Weekly (weight trend, completed vs planned, top-4 progress,
   pace) and Monthly (measurements, compound tests, mile trial, photos),
   laid out like the sheet.
6. **Settings / Auth** — passkey enrollment, units, export.

Mobile-first layout; works installed and offline.

---

## 8. Offline & Sync

- Service worker caches the app shell for offline launch.
- The active session is held in **IndexedDB**; every edit also enqueues a
  mutation `{ mutationId, method, path, body }`.
- On reconnect (or `sync` event) the queue is replayed in order. The Worker
  records each `mutationId` in `applied_mutation` and ignores duplicates.
- Reads while offline serve last-known data from IndexedDB.

---

## 9. Tech / Repo Layout

```
/                     wrangler + root config
  package.json
  wrangler.toml       # Worker + D1 + R2 bindings, Pages config
  /migrations         # D1 SQL migrations
  /api                # Worker source (Hono router, handlers, progression, auth)
  /web                # PWA (Vite): app shell, screens, IndexedDB, service worker
  /shared             # types shared between api and web
  DESIGN.md
```

- **Lang:** TypeScript across `api`, `web`, `shared`.
- **DB access:** plain SQL via D1 prepared statements (no heavy ORM).
- **Build/deploy:** `wrangler` for Worker + D1 migrations; Pages for `web`.

---

## 10. Build Roadmap

1. **Scaffold** — repo layout, `wrangler.toml`, D1 schema + first migration,
   shared types, Worker "hello" + Vite PWA shell that builds. ← *start here*
2. **Auth** — single-user register/login, passkey + password, session cookies.
3. **Exercises & Routines** — CRUD + UI.
4. **Today / session logging** — create-from-routine, progression engine,
   live set editing, daily metrics, running block. Offline + sync.
5. **Progress dashboards** — per-exercise, bodyweight, volume, pace charts.
6. **Weekly & monthly summaries** — sheet-matching views; photo upload to R2.
7. **Deploy** — provision D1 + R2 on the user's Cloudflare account, run
   migrations, ship Pages + Worker.

---

## 11. Open / Deferred

- Data import from the existing paper sheet history (manual entry vs CSV).
- Plate calculator and warmup-set auto-generation.
- Rest timer.
- Export/backup (JSON/CSV download).
- Strava / Apple Health import for runs.
