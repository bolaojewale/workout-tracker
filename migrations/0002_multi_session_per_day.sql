-- Allow multiple workouts per day: drop UNIQUE(user_id, date, routine_id) from
-- session. SQLite can't drop a table constraint in place, so rebuild the table.
-- (See DESIGN.md §4 / feature 3.) Foreign keys referencing session use ON
-- DELETE CASCADE; we disable FK enforcement during the swap so child rows aren't
-- cascade-deleted when the old table is dropped, then re-point them.

PRAGMA foreign_keys = OFF;

CREATE TABLE session_new (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
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
  updated_at  INTEGER NOT NULL
);

INSERT INTO session_new
  SELECT id, user_id, date, routine_id, title, body_weight, sleep_hours, energy,
         mood, protein_hit, calories, notes, completed, created_at, updated_at
    FROM session;

DROP TABLE session;
ALTER TABLE session_new RENAME TO session;

CREATE INDEX idx_session_user_date ON session(user_id, date);

PRAGMA foreign_keys = ON;
