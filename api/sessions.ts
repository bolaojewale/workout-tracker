// Sessions: create-from-routine with the progression engine, live set editing,
// daily metrics, and the running block. See DESIGN.md §5 (progression) and §6.
import { Hono } from "hono";
import type { AppEnv, Env } from "./index";
import { requireAuth } from "./auth";
import { estimatedOneRepMax } from "../shared/types";
import type { Session, SessionExercise, SetEntry, RunBlock, RunType } from "../shared/types";

// ---------- row types ----------
interface SessionRow {
  id: string;
  date: string;
  routine_id: string | null;
  title: string | null;
  body_weight: number | null;
  body_fat: number | null;
  muscle_mass: number | null;
  sleep_hours: number | null;
  energy: number | null;
  mood: number | null;
  protein_hit: number | null;
  calories: number | null;
  notes: string | null;
  completed: number;
  created_at: number;
}
interface SxRow {
  id: string;
  exercise_id: string;
  position: number;
  rpe: number | null;
}
interface SetRow {
  id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  is_warmup: number;
  completed: number;
}
interface RunRow {
  distance_mi: number | null;
  duration_sec: number | null;
  effort: number | null;
  run_type: string | null;
}

// ---------- load a full session ----------
async function loadSession(env: Env, userId: string, id: string): Promise<Session | null> {
  const s = await env.DB.prepare("SELECT * FROM session WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<SessionRow>();
  if (!s) return null;

  const sx = await env.DB.prepare(
    "SELECT * FROM session_exercise WHERE session_id = ? ORDER BY position",
  )
    .bind(id)
    .all<SxRow>();
  const exercises: SessionExercise[] = [];
  for (const row of sx.results ?? []) {
    const sets = await env.DB.prepare(
      "SELECT * FROM set_entry WHERE session_exercise_id = ? ORDER BY set_number",
    )
      .bind(row.id)
      .all<SetRow>();
    exercises.push({
      id: row.id,
      exerciseId: row.exercise_id,
      position: row.position,
      rpe: row.rpe,
      sets: (sets.results ?? []).map(toSet),
    });
  }

  const run = await env.DB.prepare("SELECT * FROM run_entry WHERE session_id = ?")
    .bind(id)
    .first<RunRow>();

  return {
    id: s.id,
    date: s.date,
    routineId: s.routine_id,
    title: s.title,
    bodyWeight: s.body_weight,
    bodyFat: s.body_fat,
    muscleMass: s.muscle_mass,
    sleepHours: s.sleep_hours,
    energy: s.energy,
    mood: s.mood,
    proteinHit: s.protein_hit === null ? null : !!s.protein_hit,
    calories: s.calories,
    notes: s.notes,
    completed: !!s.completed,
    createdAt: s.created_at,
    exercises,
    run: run
      ? {
          distanceMi: run.distance_mi,
          durationSec: run.duration_sec,
          effort: run.effort,
          runType: run.run_type as RunType | null,
        }
      : null,
  };
}

function toSet(r: SetRow): SetEntry {
  return {
    id: r.id,
    setNumber: r.set_number,
    weight: r.weight,
    reps: r.reps,
    rpe: r.rpe,
    isWarmup: !!r.is_warmup,
    completed: !!r.completed,
  };
}

// ---------- progression engine ----------
interface Suggestion {
  weight: number | null;
  reps: number | null;
  suggested: boolean;
}

// Suggest numbers for an exercise based on its most recent prior performance.
async function suggestFor(
  env: Env,
  userId: string,
  exerciseId: string,
  targetReps: number | null,
  step: number,
  beforeSessionId: string,
): Promise<Suggestion> {
  // Most recent working sets for this exercise in any earlier session.
  const prior = await env.DB.prepare(
    `SELECT se.id AS sx_id
       FROM session_exercise se
       JOIN session s ON s.id = se.session_id
      WHERE se.exercise_id = ? AND s.user_id = ? AND se.session_id != ?
      ORDER BY s.date DESC, s.created_at DESC
      LIMIT 1`,
  )
    .bind(exerciseId, userId, beforeSessionId)
    .first<{ sx_id: string }>();
  if (!prior) return { weight: null, reps: targetReps, suggested: false };

  const sets = await env.DB.prepare(
    "SELECT * FROM set_entry WHERE session_exercise_id = ? AND is_warmup = 0",
  )
    .bind(prior.sx_id)
    .all<SetRow>();
  const working = (sets.results ?? []).filter((s) => s.weight != null && s.reps != null);
  if (!working.length) return { weight: null, reps: targetReps, suggested: false };

  // Best set by estimated 1RM is the base.
  const best = working.reduce((a, b) =>
    estimatedOneRepMax(b.weight!, b.reps!) > estimatedOneRepMax(a.weight!, a.reps!) ? b : a,
  );

  // Ready to add weight if every working set met the target reps last time.
  const metTarget =
    targetReps != null && working.every((s) => (s.reps ?? 0) >= targetReps);
  return {
    weight: metTarget ? best.weight! + step : best.weight,
    reps: targetReps ?? best.reps,
    suggested: true,
  };
}

// ---------- routes ----------
const sessions = new Hono<AppEnv>();
sessions.use("*", requireAuth);

// Create (or return existing) a session for a date+routine, prefilled.
// Multiple workouts per day are allowed: by default we reopen the most recent
// matching session for the date+routine, but `forceNew` always creates a fresh
// one (used by the "Start another" action).
sessions.post("/", async (c) => {
  const userId = c.get("userId");
  const b = await c.req.json<{ date?: string; routineId?: string | null; forceNew?: boolean }>();
  const date = b.date ?? new Date().toISOString().slice(0, 10);
  const routineId = b.routineId ?? null;

  if (!b.forceNew) {
    const existing = await c.env.DB.prepare(
      "SELECT id FROM session WHERE user_id = ? AND date = ? AND routine_id IS ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(userId, date, routineId)
      .first<{ id: string }>();
    if (existing) return c.json(await loadSession(c.env, userId, existing.id));
  }

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  let title: string | null = null;

  const stmts: D1PreparedStatement[] = [];

  if (routineId) {
    const routine = await c.env.DB.prepare(
      "SELECT name FROM routine WHERE id = ? AND user_id = ?",
    )
      .bind(routineId, userId)
      .first<{ name: string }>();
    if (!routine) return c.json({ error: "routine not found" }, 404);
    title = routine.name;

    const rexs = await c.env.DB.prepare(
      `SELECT re.exercise_id, re.position, re.target_sets, re.target_reps, e.progression_step
         FROM routine_exercise re JOIN exercise e ON e.id = re.exercise_id
        WHERE re.routine_id = ? ORDER BY re.position`,
    )
      .bind(routineId)
      .all<{
        exercise_id: string;
        position: number;
        target_sets: number;
        target_reps: number | null;
        progression_step: number;
      }>();

    for (const re of rexs.results ?? []) {
      const sxId = crypto.randomUUID();
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO session_exercise (id, session_id, exercise_id, position, rpe) VALUES (?, ?, ?, ?, NULL)",
        ).bind(sxId, sessionId, re.exercise_id, re.position),
      );
      const sug = await suggestFor(
        c.env,
        userId,
        re.exercise_id,
        re.target_reps,
        re.progression_step,
        sessionId,
      );
      for (let i = 1; i <= re.target_sets; i++) {
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO set_entry (id, session_exercise_id, set_number, weight, reps, rpe, is_warmup, completed)
             VALUES (?, ?, ?, ?, ?, NULL, 0, 0)`,
          ).bind(crypto.randomUUID(), sxId, i, sug.weight, sug.reps),
        );
      }
    }
  }

  stmts.unshift(
    c.env.DB.prepare(
      `INSERT INTO session (id, user_id, date, routine_id, title, completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(sessionId, userId, date, routineId, title, now, now),
  );
  await c.env.DB.batch(stmts);
  return c.json(await loadSession(c.env, userId, sessionId), 201);
});

sessions.get("/", async (c) => {
  const from = c.req.query("from") ?? "0000-01-01";
  const to = c.req.query("to") ?? "9999-12-31";
  const rows = await c.env.DB.prepare(
    "SELECT id FROM session WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC",
  )
    .bind(c.get("userId"), from, to)
    .all<{ id: string }>();
  const list = await Promise.all(
    (rows.results ?? []).map((r) => loadSession(c.env, c.get("userId"), r.id)),
  );
  return c.json(list.filter(Boolean));
});

sessions.get("/:id", async (c) => {
  const s = await loadSession(c.env, c.get("userId"), c.req.param("id"));
  return s ? c.json(s) : c.json({ error: "not found" }, 404);
});

// Daily metrics / notes / completed / title.
sessions.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId");
  const owned = await c.env.DB.prepare("SELECT id FROM session WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ id: string }>();
  if (!owned) return c.json({ error: "not found" }, 404);

  const b = await c.req.json<Partial<Session>>();
  const fields: Record<string, unknown> = {
    title: b.title,
    body_weight: b.bodyWeight,
    body_fat: b.bodyFat,
    muscle_mass: b.muscleMass,
    sleep_hours: b.sleepHours,
    energy: b.energy,
    mood: b.mood,
    protein_hit: b.proteinHit === undefined ? undefined : b.proteinHit ? 1 : 0,
    calories: b.calories,
    notes: b.notes,
    completed: b.completed === undefined ? undefined : b.completed ? 1 : 0,
  };
  const sets = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (sets.length) {
    const sql = `UPDATE session SET ${sets.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
    await c.env.DB.prepare(sql)
      .bind(...sets.map(([, v]) => v), Date.now(), id)
      .run();
  }
  return c.json(await loadSession(c.env, userId, id));
});

// Add an exercise to an existing session (mid-workout). Resolves the exercise
// by id, or by name (creating it in the library if new), then prefills sets via
// the progression engine. Appends after the last exercise.
sessions.post("/:id/exercises", async (c) => {
  const userId = c.get("userId");
  const sessionId = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM session WHERE id = ? AND user_id = ?")
    .bind(sessionId, userId)
    .first<{ id: string }>();
  if (!owned) return c.json({ error: "not found" }, 404);

  const b = await c.req.json<{
    exerciseId?: string;
    name?: string;
    targetSets?: number;
    targetReps?: number | null;
  }>();

  // Resolve the exercise: explicit id, else match by name, else create it.
  let exerciseId = b.exerciseId ?? null;
  let progressionStep = 5;
  if (exerciseId) {
    const ex = await c.env.DB.prepare(
      "SELECT progression_step FROM exercise WHERE id = ? AND user_id = ?",
    )
      .bind(exerciseId, userId)
      .first<{ progression_step: number }>();
    if (!ex) return c.json({ error: "exercise not found" }, 404);
    progressionStep = ex.progression_step;
  } else if (b.name?.trim()) {
    const name = b.name.trim();
    const match = await c.env.DB.prepare(
      "SELECT id, progression_step FROM exercise WHERE user_id = ? AND lower(name) = lower(?) AND archived = 0",
    )
      .bind(userId, name)
      .first<{ id: string; progression_step: number }>();
    if (match) {
      exerciseId = match.id;
      progressionStep = match.progression_step;
    } else {
      exerciseId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO exercise
           (id, user_id, name, kind, muscle_group, default_sets, is_favorite, unit, progression_step, archived, created_at)
         VALUES (?, ?, ?, 'lift', NULL, 3, 0, 'lbs', 5, 0, ?)`,
      )
        .bind(exerciseId, userId, name, Date.now())
        .run();
    }
  } else {
    return c.json({ error: "exerciseId or name required" }, 400);
  }

  const targetReps = b.targetReps ?? null;
  const targetSets = b.targetSets ?? 3;

  const posRow = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM session_exercise WHERE session_id = ?",
  )
    .bind(sessionId)
    .first<{ pos: number }>();

  const sxId = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "INSERT INTO session_exercise (id, session_id, exercise_id, position, rpe) VALUES (?, ?, ?, ?, NULL)",
    ).bind(sxId, sessionId, exerciseId, posRow?.pos ?? 0),
  ];
  const sug = await suggestFor(c.env, userId, exerciseId, targetReps, progressionStep, sessionId);
  for (let i = 1; i <= targetSets; i++) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO set_entry (id, session_exercise_id, set_number, weight, reps, rpe, is_warmup, completed)
         VALUES (?, ?, ?, ?, ?, NULL, 0, 0)`,
      ).bind(crypto.randomUUID(), sxId, i, sug.weight, sug.reps),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json(await loadSession(c.env, userId, sessionId), 201);
});

sessions.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM session WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Upsert the running block.
sessions.put("/:id/run", async (c) => {
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM session WHERE id = ? AND user_id = ?")
    .bind(id, c.get("userId"))
    .first<{ id: string }>();
  if (!owned) return c.json({ error: "not found" }, 404);

  const b = await c.req.json<RunBlock>();
  await c.env.DB.prepare(
    `INSERT INTO run_entry (id, session_id, distance_mi, duration_sec, effort, run_type)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       distance_mi = excluded.distance_mi, duration_sec = excluded.duration_sec,
       effort = excluded.effort, run_type = excluded.run_type`,
  )
    .bind(crypto.randomUUID(), id, b.distanceMi, b.durationSec, b.effort, b.runType)
    .run();
  return c.json(await loadSession(c.env, c.get("userId"), id));
});

// Verify a session_exercise belongs to the user (ownership guard for set edits).
async function ownsSx(env: Env, userId: string, sxId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM session_exercise se JOIN session s ON s.id = se.session_id
      WHERE se.id = ? AND s.user_id = ?`,
  )
    .bind(sxId, userId)
    .first<{ ok: number }>();
  return !!row;
}
async function ownsSet(env: Env, userId: string, setId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT se.id AS sx FROM set_entry st
       JOIN session_exercise se ON se.id = st.session_exercise_id
       JOIN session s ON s.id = se.session_id
      WHERE st.id = ? AND s.user_id = ?`,
  )
    .bind(setId, userId)
    .first<{ sx: string }>();
  return row?.sx ?? null;
}

export const setRoutes = new Hono<AppEnv>();
setRoutes.use("*", requireAuth);

setRoutes.patch("/session-exercises/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await ownsSx(c.env, c.get("userId"), id))) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ rpe?: number | null }>();
  await c.env.DB.prepare("UPDATE session_exercise SET rpe = ? WHERE id = ?")
    .bind(b.rpe ?? null, id)
    .run();
  return c.json({ ok: true });
});

// Remove an exercise from a session (this session only; cascades its sets).
// The routine template is untouched.
setRoutes.delete("/session-exercises/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await ownsSx(c.env, c.get("userId"), id))) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("DELETE FROM session_exercise WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

setRoutes.post("/session-exercises/:id/sets", async (c) => {
  const sxId = c.req.param("id");
  if (!(await ownsSx(c.env, c.get("userId"), sxId))) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<Partial<SetEntry>>();
  const next = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(set_number), 0) + 1 AS n FROM set_entry WHERE session_exercise_id = ?",
  )
    .bind(sxId)
    .first<{ n: number }>();
  // Accept a client-generated id so offline-created sets are idempotent on replay.
  const id = b.id ?? crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO set_entry (id, session_exercise_id, set_number, weight, reps, rpe, is_warmup, completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      sxId,
      next?.n ?? 1,
      b.weight ?? null,
      b.reps ?? null,
      b.rpe ?? null,
      b.isWarmup ? 1 : 0,
      b.completed === false ? 0 : 1,
    )
    .run();
  return c.json({ id, setNumber: next?.n ?? 1 }, 201);
});

setRoutes.patch("/sets/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await ownsSet(c.env, c.get("userId"), id))) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<Partial<SetEntry>>();
  const fields: Record<string, unknown> = {
    weight: b.weight,
    reps: b.reps,
    rpe: b.rpe,
    is_warmup: b.isWarmup === undefined ? undefined : b.isWarmup ? 1 : 0,
    completed: b.completed === undefined ? undefined : b.completed ? 1 : 0,
  };
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length) {
    await c.env.DB.prepare(
      `UPDATE set_entry SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
    )
      .bind(...entries.map(([, v]) => v), id)
      .run();
  }
  return c.json({ ok: true });
});

setRoutes.delete("/sets/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await ownsSet(c.env, c.get("userId"), id))) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("DELETE FROM set_entry WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default sessions;
