-- Body composition metrics + nutrition (meals library and per-day meal log).
-- See feature request: body fat % / muscle mass on Daily metrics; a Food card
-- with per-meal macros; a reusable Meals library like Routines.

-- Body composition on the per-session daily metrics.
ALTER TABLE session ADD COLUMN body_fat REAL;       -- %
ALTER TABLE session ADD COLUMN muscle_mass REAL;    -- lbs

-- Daily protein goal (grams); "protein hit" is derived from logged meals.
ALTER TABLE user ADD COLUMN protein_goal REAL;

-- Reusable meal library (like a routine, but macros).
CREATE TABLE meal (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  protein    REAL NOT NULL DEFAULT 0,  -- grams
  carbs      REAL NOT NULL DEFAULT 0,  -- grams
  fat        REAL NOT NULL DEFAULT 0,  -- grams
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_meal_user ON meal(user_id, archived);

-- Per-day logged meals. meal_id links to the library when chosen from it, but
-- name/macros are copied so edits to the library don't rewrite history.
CREATE TABLE meal_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,            -- 'YYYY-MM-DD'
  meal_id    TEXT REFERENCES meal(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  protein    REAL NOT NULL DEFAULT 0,
  carbs      REAL NOT NULL DEFAULT 0,
  fat        REAL NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_meal_log_user_date ON meal_log(user_id, date);
