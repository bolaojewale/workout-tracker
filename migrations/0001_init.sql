-- BJ Workout Tracker — initial schema
-- See DESIGN.md §4 for the full data model.

PRAGMA foreign_keys = ON;

CREATE TABLE user (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE,
  display_name TEXT,
  units        TEXT NOT NULL DEFAULT 'imperial',
  created_at   INTEGER NOT NULL
);

CREATE TABLE credential (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,            -- 'passkey' | 'password'
  public_key    BLOB,
  counter       INTEGER DEFAULT 0,
  password_hash TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_credential_user ON credential(user_id);

CREATE TABLE exercise (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'lift',  -- 'lift' | 'cardio'
  muscle_group     TEXT,
  default_sets     INTEGER NOT NULL DEFAULT 3,
  is_favorite      INTEGER NOT NULL DEFAULT 0,
  unit             TEXT NOT NULL DEFAULT 'lbs',
  progression_step REAL NOT NULL DEFAULT 5,
  archived         INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_exercise_user ON exercise(user_id, archived);

CREATE TABLE routine (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  notes      TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_routine_user ON routine(user_id, archived);

CREATE TABLE routine_exercise (
  id          TEXT PRIMARY KEY,
  routine_id  TEXT NOT NULL REFERENCES routine(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps INTEGER,
  UNIQUE(routine_id, exercise_id)
);

CREATE TABLE session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,             -- 'YYYY-MM-DD'
  routine_id  TEXT REFERENCES routine(id) ON DELETE SET NULL,
  title       TEXT,
  body_weight REAL,
  sleep_hours REAL,
  energy      INTEGER,
  mood        INTEGER,
  protein_hit INTEGER,
  calories    INTEGER,
  notes       TEXT,
  completed   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(user_id, date, routine_id)
);
CREATE INDEX idx_session_user_date ON session(user_id, date);

CREATE TABLE session_exercise (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  rpe         REAL
);
CREATE INDEX idx_sx_session ON session_exercise(session_id);
CREATE INDEX idx_sx_exercise ON session_exercise(exercise_id);

CREATE TABLE set_entry (
  id                  TEXT PRIMARY KEY,
  session_exercise_id TEXT NOT NULL REFERENCES session_exercise(id) ON DELETE CASCADE,
  set_number          INTEGER NOT NULL,
  weight              REAL,
  reps                INTEGER,
  rpe                 REAL,
  is_warmup           INTEGER NOT NULL DEFAULT 0,
  completed           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_set_sx ON set_entry(session_exercise_id);

CREATE TABLE run_entry (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  distance_mi  REAL,
  duration_sec INTEGER,
  effort       INTEGER,
  run_type     TEXT,
  UNIQUE(session_id)
);

CREATE TABLE checkin (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  chest REAL, waist REAL, hips REAL, arms REAL, thighs REAL, forearms REAL,
  body_weight   REAL,
  mile_time_sec INTEGER,
  notes         TEXT
);
CREATE INDEX idx_checkin_user ON checkin(user_id, date);

CREATE TABLE checkin_lift (
  id          TEXT PRIMARY KEY,
  checkin_id  TEXT NOT NULL REFERENCES checkin(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
  weight      REAL,
  reps        INTEGER
);

CREATE TABLE photo (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  checkin_id TEXT REFERENCES checkin(id) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL,
  angle      TEXT,
  taken_at   INTEGER NOT NULL
);

-- Idempotency log for replayed offline mutations.
CREATE TABLE applied_mutation (
  id         TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
