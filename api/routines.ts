// Routine (workout template) CRUD. A routine is an ordered list of exercises
// with target sets/reps. All routes require auth and are user-scoped.
import { Hono } from "hono";
import type { AppEnv } from "./index";
import { requireAuth } from "./auth";
import type { Routine, RoutineExercise } from "../shared/types";

interface RoutineRow {
  id: string;
  name: string;
  notes: string | null;
  archived: number;
}
interface RoutineExerciseRow {
  id: string;
  exercise_id: string;
  position: number;
  target_sets: number;
  target_reps: number | null;
}

async function loadRoutine(
  env: AppEnv["Bindings"],
  userId: string,
  id: string,
): Promise<Routine | null> {
  const r = await env.DB.prepare(
    "SELECT * FROM routine WHERE id = ? AND user_id = ?",
  )
    .bind(id, userId)
    .first<RoutineRow>();
  if (!r) return null;
  const rows = await env.DB.prepare(
    "SELECT * FROM routine_exercise WHERE routine_id = ? ORDER BY position",
  )
    .bind(id)
    .all<RoutineExerciseRow>();
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    archived: !!r.archived,
    exercises: (rows.results ?? []).map(
      (e): RoutineExercise => ({
        id: e.id,
        exerciseId: e.exercise_id,
        position: e.position,
        targetSets: e.target_sets,
        targetReps: e.target_reps,
      }),
    ),
  };
}

interface RoutineInput {
  name?: string;
  notes?: string | null;
  exercises?: { exerciseId: string; targetSets?: number; targetReps?: number | null }[];
}

// Replace the routine's exercise list (delete + reinsert in order).
function exerciseStatements(
  env: AppEnv["Bindings"],
  routineId: string,
  list: NonNullable<RoutineInput["exercises"]>,
) {
  const insert = env.DB.prepare(
    `INSERT INTO routine_exercise
       (id, routine_id, exercise_id, position, target_sets, target_reps)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  return list.map((e, i) =>
    insert.bind(
      crypto.randomUUID(),
      routineId,
      e.exerciseId,
      i,
      e.targetSets ?? 3,
      e.targetReps ?? null,
    ),
  );
}

const routines = new Hono<AppEnv>();
routines.use("*", requireAuth);

routines.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id FROM routine WHERE user_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE",
  )
    .bind(c.get("userId"))
    .all<{ id: string }>();
  const list = await Promise.all(
    (rows.results ?? []).map((r) => loadRoutine(c.env, c.get("userId"), r.id)),
  );
  return c.json(list.filter(Boolean));
});

routines.get("/:id", async (c) => {
  const r = await loadRoutine(c.env, c.get("userId"), c.req.param("id"));
  return r ? c.json(r) : c.json({ error: "not found" }, 404);
});

routines.post("/", async (c) => {
  const b = await c.req.json<RoutineInput>();
  if (!b.name?.trim()) return c.json({ error: "name is required" }, 400);
  const id = crypto.randomUUID();
  const stmts = [
    c.env.DB.prepare(
      "INSERT INTO routine (id, user_id, name, notes, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    ).bind(id, c.get("userId"), b.name.trim(), b.notes ?? null, Date.now()),
    ...exerciseStatements(c.env, id, b.exercises ?? []),
  ];
  await c.env.DB.batch(stmts);
  return c.json(await loadRoutine(c.env, c.get("userId"), id), 201);
});

routines.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    "SELECT id FROM routine WHERE id = ? AND user_id = ?",
  )
    .bind(id, c.get("userId"))
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "not found" }, 404);

  const b = await c.req.json<RoutineInput>();
  const stmts = [];
  if (b.name !== undefined || b.notes !== undefined) {
    stmts.push(
      c.env.DB.prepare("UPDATE routine SET name = COALESCE(?, name), notes = ? WHERE id = ?").bind(
        b.name?.trim() ?? null,
        b.notes ?? null,
        id,
      ),
    );
  }
  if (b.exercises !== undefined) {
    stmts.push(c.env.DB.prepare("DELETE FROM routine_exercise WHERE routine_id = ?").bind(id));
    stmts.push(...exerciseStatements(c.env, id, b.exercises));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(await loadRoutine(c.env, c.get("userId"), id));
});

routines.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare(
    "UPDATE routine SET archived = 1 WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

export default routines;
