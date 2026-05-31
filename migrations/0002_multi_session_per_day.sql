-- Allow multiple workouts per day: drop UNIQUE(user_id, date, routine_id) from
-- session. SQLite can't drop a table constraint in place, so the table must be
-- rebuilt. On D1 foreign keys stay ENFORCED during migrations, so DROP TABLE
-- session would cascade-delete its children (session_exercise -> set_entry, and
-- run_entry). To avoid losing logged data, we back the children up first and
-- restore them after the rebuild. The DELETE-before-INSERT makes this correct
-- whether or not the cascade actually fired (e.g. FKs off locally).

CREATE TABLE _se_bak  AS SELECT * FROM session_exercise;
CREATE TABLE _set_bak AS SELECT * FROM set_entry;
CREATE TABLE _run_bak AS SELECT * FROM run_entry;

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

-- Repopulate children from the backups (in dependency order). DELETE first so a
-- cascade that already emptied them doesn't cause PK conflicts on re-insert.
DELETE FROM run_entry;
DELETE FROM session_exercise;   -- cascades to set_entry if FKs are on
INSERT INTO session_exercise SELECT * FROM _se_bak;
INSERT INTO set_entry        SELECT * FROM _set_bak;
INSERT INTO run_entry        SELECT * FROM _run_bak;

DROP TABLE _se_bak;
DROP TABLE _set_bak;
DROP TABLE _run_bak;
