// Progress stats: per-exercise strength (est-1RM) + volume, bodyweight trend,
// weekly total volume, and running pace trend. See DESIGN.md §6.
import { Hono } from "hono";
import type { AppEnv } from "./index";
import { requireAuth } from "./auth";
import { estimatedOneRepMax } from "../shared/types";

const stats = new Hono<AppEnv>();
stats.use("*", requireAuth);

interface WorkingSetRow {
  date: string;
  weight: number;
  reps: number;
}

// Per-exercise: one point per session date with best-set est-1RM and total volume.
stats.get("/exercise/:id", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.date AS date, st.weight AS weight, st.reps AS reps
       FROM set_entry st
       JOIN session_exercise se ON se.id = st.session_exercise_id
       JOIN session s ON s.id = se.session_id
      WHERE se.exercise_id = ? AND s.user_id = ?
        AND st.is_warmup = 0 AND st.weight IS NOT NULL AND st.reps IS NOT NULL
      ORDER BY s.date`,
  )
    .bind(c.req.param("id"), c.get("userId"))
    .all<WorkingSetRow>();

  const byDate = new Map<string, { oneRm: number; volume: number; bestWeight: number; bestReps: number }>();
  for (const r of rows.results ?? []) {
    const e1rm = estimatedOneRepMax(r.weight, r.reps);
    const cur = byDate.get(r.date) ?? { oneRm: 0, volume: 0, bestWeight: 0, bestReps: 0 };
    cur.volume += r.weight * r.reps;
    if (e1rm > cur.oneRm) {
      cur.oneRm = e1rm;
      cur.bestWeight = r.weight;
      cur.bestReps = r.reps;
    }
    byDate.set(r.date, cur);
  }
  const points = [...byDate.entries()].map(([date, v]) => ({
    date,
    oneRm: Math.round(v.oneRm * 10) / 10,
    volume: v.volume,
    bestWeight: v.bestWeight,
    bestReps: v.bestReps,
  }));
  return c.json({ points });
});

// Morning bodyweight over time (from daily session metric).
stats.get("/bodyweight", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT date, body_weight AS weight FROM session
      WHERE user_id = ? AND body_weight IS NOT NULL ORDER BY date`,
  )
    .bind(c.get("userId"))
    .all<{ date: string; weight: number }>();
  return c.json({ points: rows.results ?? [] });
});

// Total working-set volume per ISO week (Mon-anchored).
stats.get("/volume", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.date AS date, st.weight AS weight, st.reps AS reps
       FROM set_entry st
       JOIN session_exercise se ON se.id = st.session_exercise_id
       JOIN session s ON s.id = se.session_id
      WHERE s.user_id = ? AND st.is_warmup = 0
        AND st.weight IS NOT NULL AND st.reps IS NOT NULL
      ORDER BY s.date`,
  )
    .bind(c.get("userId"))
    .all<WorkingSetRow>();

  const byWeek = new Map<string, number>();
  for (const r of rows.results ?? []) {
    const wk = weekStart(r.date);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + r.weight * r.reps);
  }
  const points = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, volume]) => ({ week, volume }));
  return c.json({ points });
});

// Running pace (sec/mi) over time, with type for filtering.
stats.get("/running", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.date AS date, r.distance_mi AS distance, r.duration_sec AS duration, r.run_type AS type
       FROM run_entry r JOIN session s ON s.id = r.session_id
      WHERE s.user_id = ? AND r.distance_mi > 0 AND r.duration_sec > 0
      ORDER BY s.date`,
  )
    .bind(c.get("userId"))
    .all<{ date: string; distance: number; duration: number; type: string | null }>();
  const points = (rows.results ?? []).map((r) => ({
    date: r.date,
    pace: Math.round(r.duration / r.distance),
    distance: r.distance,
    type: r.type,
  }));
  return c.json({ points });
});

// Monday of the ISO week containing the given YYYY-MM-DD.
function weekStart(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export default stats;
