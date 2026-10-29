// Exercise library CRUD. All routes require auth and are scoped to the user.
import { Hono } from "hono";
import type { AppEnv } from "./index";
import { requireAuth } from "./auth";
import type { Exercise, ExerciseKind } from "../shared/types";

interface ExerciseRow {
  id: string;
  name: string;
  kind: string;
  muscle_group: string | null;
  default_sets: number;
  is_favorite: number;
  unit: string;
  progression_step: number;
  archived: number;
  session_count?: number;
}

function toExercise(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ExerciseKind,
    muscleGroup: r.muscle_group,
    defaultSets: r.default_sets,
    isFavorite: !!r.is_favorite,
    unit: r.unit,
    progressionStep: r.progression_step,
    archived: !!r.archived,
    ...(r.session_count !== undefined ? { sessionCount: r.session_count } : {}),
  };
}

const exercises = new Hono<AppEnv>();
exercises.use("*", requireAuth);

exercises.get("/", async (c) => {
  const includeArchived = c.req.query("archived") === "1";
  const rows = await c.env.DB.prepare(
    `SELECT e.*,
            (SELECT COUNT(*) FROM session_exercise se WHERE se.exercise_id = e.id) AS session_count
       FROM exercise e
      WHERE e.user_id = ? ${includeArchived ? "" : "AND e.archived = 0"}
      ORDER BY e.is_favorite DESC, e.name COLLATE NOCASE`,
  )
    .bind(c.get("userId"))
    .all<ExerciseRow>();
  return c.json((rows.results ?? []).map(toExercise));
});

exercises.post("/", async (c) => {
  const b = await c.req.json<Partial<Exercise>>();
  if (!b.name?.trim()) return c.json({ error: "name is required" }, 400);
  const id = crypto.randomUUID();
  const kind: ExerciseKind = b.kind === "cardio" ? "cardio" : "lift";
  await c.env.DB.prepare(
    `INSERT INTO exercise
       (id, user_id, name, kind, muscle_group, default_sets, is_favorite, unit, progression_step, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(
      id,
      c.get("userId"),
      b.name.trim(),
      kind,
      b.muscleGroup ?? null,
      b.defaultSets ?? (kind === "cardio" ? 1 : 3),
      b.isFavorite ? 1 : 0,
      b.unit ?? (kind === "cardio" ? "mi" : "lbs"),
      b.progressionStep ?? 5,
      Date.now(),
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM exercise WHERE id = ?")
    .bind(id)
    .first<ExerciseRow>();
  return c.json(toExercise(row!), 201);
});

exercises.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    "SELECT * FROM exercise WHERE id = ? AND user_id = ?",
  )
    .bind(id, c.get("userId"))
    .first<ExerciseRow>();
  if (!existing) return c.json({ error: "not found" }, 404);

  const b = await c.req.json<Partial<Exercise>>();
  const merged = {
    name: b.name?.trim() ?? existing.name,
    kind: (b.kind as string) ?? existing.kind,
    muscle_group: b.muscleGroup !== undefined ? b.muscleGroup : existing.muscle_group,
    default_sets: b.defaultSets ?? existing.default_sets,
    is_favorite: b.isFavorite !== undefined ? (b.isFavorite ? 1 : 0) : existing.is_favorite,
    unit: b.unit ?? existing.unit,
    progression_step: b.progressionStep ?? existing.progression_step,
    archived: b.archived !== undefined ? (b.archived ? 1 : 0) : existing.archived,
  };
  await c.env.DB.prepare(
    `UPDATE exercise SET name=?, kind=?, muscle_group=?, default_sets=?,
       is_favorite=?, unit=?, progression_step=?, archived=?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      merged.name,
      merged.kind,
      merged.muscle_group,
      merged.default_sets,
      merged.is_favorite,
      merged.unit,
      merged.progression_step,
      merged.archived,
      id,
      c.get("userId"),
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM exercise WHERE id = ?")
    .bind(id)
    .first<ExerciseRow>();
  return c.json(toExercise(row!));
});

// Merge duplicate exercises into one. Every workout, routine, and check-in
// that referenced a removed exercise is re-pointed at `keepId`, then the
// removed rows are deleted outright (nothing references them any more).
// Where a routine already contains the kept exercise, the duplicate's row is
// dropped instead of re-pointed (UNIQUE(routine_id, exercise_id)).
exercises.post("/merge", async (c) => {
  const userId = c.get("userId");
  const b = await c.req.json<{ keepId?: string; removeIds?: string[] }>();
  const keepId = b.keepId;
  const removeIds = (b.removeIds ?? []).filter((id) => id && id !== keepId);
  if (!keepId || !removeIds.length) {
    return c.json({ error: "keepId and at least one removeId are required" }, 400);
  }

  // Every id must be one of this user's exercises.
  const ids = [keepId, ...removeIds];
  const owned = await c.env.DB.prepare(
    `SELECT id, is_favorite FROM exercise WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(userId, ...ids)
    .all<{ id: string; is_favorite: number }>();
  const found = new Set((owned.results ?? []).map((r) => r.id));
  if (ids.some((id) => !found.has(id))) return c.json({ error: "exercise not found" }, 404);

  // A favourite survives the merge even if the kept copy wasn't one.
  const anyFavorite = (owned.results ?? []).some((r) => r.is_favorite);

  const stmts: D1PreparedStatement[] = [];
  for (const rm of removeIds) {
    stmts.push(
      c.env.DB.prepare("UPDATE session_exercise SET exercise_id = ? WHERE exercise_id = ?").bind(keepId, rm),
      c.env.DB.prepare("UPDATE checkin_lift SET exercise_id = ? WHERE exercise_id = ?").bind(keepId, rm),
      c.env.DB.prepare(
        `DELETE FROM routine_exercise WHERE exercise_id = ?
           AND routine_id IN (SELECT routine_id FROM routine_exercise WHERE exercise_id = ?)`,
      ).bind(rm, keepId),
      c.env.DB.prepare("UPDATE routine_exercise SET exercise_id = ? WHERE exercise_id = ?").bind(keepId, rm),
      c.env.DB.prepare("DELETE FROM exercise WHERE id = ? AND user_id = ?").bind(rm, userId),
    );
  }
  if (anyFavorite) {
    stmts.push(c.env.DB.prepare("UPDATE exercise SET is_favorite = 1 WHERE id = ?").bind(keepId));
  }
  await c.env.DB.batch(stmts);

  const row = await c.env.DB.prepare(
    `SELECT e.*,
            (SELECT COUNT(*) FROM session_exercise se WHERE se.exercise_id = e.id) AS session_count
       FROM exercise e WHERE e.id = ?`,
  )
    .bind(keepId)
    .first<ExerciseRow>();
  return c.json({ kept: toExercise(row!), removed: removeIds.length });
});

// Soft delete (archive) so historical sessions keep referencing it.
exercises.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare(
    "UPDATE exercise SET archived = 1 WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

export default exercises;
