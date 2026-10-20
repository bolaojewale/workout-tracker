-- Start / end timestamps for a workout, set by the "Start workout" and
-- "End workout" buttons on the Today screen. Duration is derived client-side
-- as ended_at - started_at. Both are epoch ms, NULL until the button is tapped.
ALTER TABLE session ADD COLUMN started_at INTEGER;
ALTER TABLE session ADD COLUMN ended_at   INTEGER;
