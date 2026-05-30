// Weekly summary computed from sessions + runs, matching the paper sheet's
// weekly section. See DESIGN.md §6.
import { Hono } from "hono";
import type { AppEnv } from "./index";
import { requireAuth } from "./auth";

const summary = new Hono<AppEnv>();
summary.use("*", requireAuth);

function weekStart(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function avg(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
}

summary.get("/weekly", async (c) => {
  const userId = c.get("userId");
  const start = weekStart(c.req.query("week") ?? new Date().toISOString().slice(0, 10));
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  // Sessions in the week (weight, completed flag).
  const sessions = await c.env.DB.prepare(
    "SELECT date, body_weight, completed FROM session WHERE user_id = ? AND date BETWEEN ? AND ?",
  )
    .bind(userId, start, end)
    .all<{ date: string; body_weight: number | null; completed: number }>();

  const weightByDay = new Map<string, number>();
  const sessionByDay = new Map<string, { completed: boolean }>();
  for (const s of sessions.results ?? []) {
    if (s.body_weight != null) weightByDay.set(s.date, s.body_weight);
    const cur = sessionByDay.get(s.date);
    sessionByDay.set(s.date, { completed: (cur?.completed ?? false) || !!s.completed });
  }
  const weightDays = days.map((d) => ({ date: d, weight: weightByDay.get(d) ?? null }));
  const weightAvg = avg([...weightByDay.values()]);
  const workouts = days.map((d) => ({
    date: d,
    hasSession: sessionByDay.has(d),
    completed: sessionByDay.get(d)?.completed ?? false,
  }));

  // Top-4 (favorite) lifts: best set this week.
  const favs = await c.env.DB.prepare(
    "SELECT id, name, unit FROM exercise WHERE user_id = ? AND is_favorite = 1 AND archived = 0 ORDER BY name",
  )
    .bind(userId)
    .all<{ id: string; name: string; unit: string }>();
  const mainLifts = [];
  for (const f of favs.results ?? []) {
    const best = await c.env.DB.prepare(
      `SELECT st.weight AS weight, st.reps AS reps
         FROM set_entry st
         JOIN session_exercise se ON se.id = st.session_exercise_id
         JOIN session s ON s.id = se.session_id
        WHERE se.exercise_id = ? AND s.user_id = ? AND s.date BETWEEN ? AND ?
          AND st.is_warmup = 0 AND st.weight IS NOT NULL AND st.reps IS NOT NULL
        ORDER BY st.weight * (1 + st.reps / 30.0) DESC LIMIT 1`,
    )
      .bind(f.id, userId, start, end)
      .first<{ weight: number; reps: number }>();
    mainLifts.push({
      exerciseId: f.id,
      name: f.name,
      unit: f.unit,
      bestWeight: best?.weight ?? null,
      bestReps: best?.reps ?? null,
    });
  }

  // Running: paces by category + total miles.
  const runs = await c.env.DB.prepare(
    `SELECT r.distance_mi AS distance, r.duration_sec AS duration, r.run_type AS type
       FROM run_entry r JOIN session s ON s.id = r.session_id
      WHERE s.user_id = ? AND s.date BETWEEN ? AND ? AND r.distance_mi > 0 AND r.duration_sec > 0`,
  )
    .bind(userId, start, end)
    .all<{ distance: number; duration: number; type: string | null }>();
  const paceOf = (types: string[]) =>
    avg(
      (runs.results ?? [])
        .filter((r) => types.includes(r.type ?? ""))
        .map((r) => r.duration / r.distance),
    );
  const running = {
    easyPace: paceOf(["easy", "recovery"]),
    longPace: paceOf(["long"]),
    speedPace: paceOf(["tempo", "intervals"]),
    totalMiles: Math.round((runs.results ?? []).reduce((a, r) => a + r.distance, 0) * 10) / 10,
  };

  return c.json({ weekStart: start, weekEnd: end, weightDays, weightAvg, workouts, mainLifts, running });
});

export default summary;
