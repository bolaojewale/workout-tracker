// Plan import: turn an LLM-authored (or hand-written) JSON plan into real
// exercises + routines. Exercises are matched by name (case-insensitive) to
// avoid duplicates and created when missing; routines are upserted by name.
//
// Accepted shapes (both normalize to a list of routines):
//   { "routines": [ { name, notes?, exercises: [ PlanExercise ] } ] }
//   { "routine": { name, notes? }, "exercises": [ PlanExercise ] }   (single)
//
// PlanExercise:
//   { name, kind?, muscleGroup?, unit?, progressionStep?, isFavorite?,
//     targetSets?, targetReps? }
import { Hono } from "hono";
import type { AppEnv, Env } from "./index";
import { requireAuth } from "./auth";

interface PlanExercise {
  name?: string;
  kind?: string;
  muscleGroup?: string | null;
  unit?: string;
  defaultSets?: number;
  progressionStep?: number;
  isFavorite?: boolean;
  targetSets?: number;
  targetReps?: number | null;
}
interface PlanRoutine {
  name?: string;
  notes?: string | null;
  exercises?: PlanExercise[];
}
interface Plan {
  routines?: PlanRoutine[];
  routine?: PlanRoutine;
  exercises?: PlanExercise[];
}

const imp = new Hono<AppEnv>();
imp.use("*", requireAuth);

// A copy-pasteable schema + example so users can ask Claude for a valid plan.
imp.get("/schema", (c) => c.json(SCHEMA_DOC));

imp.post("/", async (c) => {
  let plan: Plan;
  try {
    plan = await c.req.json<Plan>();
  } catch {
    return c.json({ error: "Body must be valid JSON" }, 400);
  }

  // Normalize to a list of routines.
  const routines: PlanRoutine[] = plan.routines
    ? plan.routines
    : plan.routine || plan.exercises
      ? [{ ...(plan.routine ?? {}), exercises: plan.routine?.exercises ?? plan.exercises }]
      : [];

  if (!routines.length) {
    return c.json({ error: "No routines found. Provide 'routines' or 'routine'+'exercises'." }, 400);
  }
  for (const r of routines) {
    if (!r.name?.trim()) return c.json({ error: "Every routine needs a name" }, 400);
    if (!r.exercises?.length) return c.json({ error: `Routine "${r.name}" has no exercises` }, 400);
    for (const e of r.exercises) {
      if (!e.name?.trim()) return c.json({ error: `An exercise in "${r.name}" is missing a name` }, 400);
    }
  }

  const userId = c.get("userId");
  const summary = { routinesCreated: 0, routinesUpdated: 0, exercisesCreated: 0, exercisesMatched: 0 };
  const resultRoutines: { id: string; name: string; exercises: number }[] = [];

  // Resolve every referenced exercise to an id, creating missing ones once.
  const nameToId = await buildExerciseIndex(c.env, userId);

  for (const r of routines) {
    for (const e of r.exercises!) {
      const key = e.name!.trim().toLowerCase();
      if (nameToId.has(key)) {
        summary.exercisesMatched++;
        continue;
      }
      const id = crypto.randomUUID();
      const kind = e.kind === "cardio" ? "cardio" : "lift";
      await c.env.DB.prepare(
        `INSERT INTO exercise
           (id, user_id, name, kind, muscle_group, default_sets, is_favorite, unit, progression_step, archived, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
        .bind(
          id,
          userId,
          e.name!.trim(),
          kind,
          e.muscleGroup ?? null,
          e.defaultSets ?? e.targetSets ?? (kind === "cardio" ? 1 : 3),
          e.isFavorite ? 1 : 0,
          e.unit ?? (kind === "cardio" ? "mi" : "lbs"),
          e.progressionStep ?? 5,
          Date.now(),
        )
        .run();
      nameToId.set(key, id);
      summary.exercisesCreated++;
    }

    // Upsert the routine by name (replace its exercise list).
    const existing = await c.env.DB.prepare(
      "SELECT id FROM routine WHERE user_id = ? AND name = ? AND archived = 0",
    )
      .bind(userId, r.name!.trim())
      .first<{ id: string }>();

    const routineId = existing?.id ?? crypto.randomUUID();
    const stmts = [];
    if (existing) {
      stmts.push(
        c.env.DB.prepare("UPDATE routine SET notes = ? WHERE id = ?").bind(r.notes ?? null, routineId),
        c.env.DB.prepare("DELETE FROM routine_exercise WHERE routine_id = ?").bind(routineId),
      );
      summary.routinesUpdated++;
    } else {
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO routine (id, user_id, name, notes, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        ).bind(routineId, userId, r.name!.trim(), r.notes ?? null, Date.now()),
      );
      summary.routinesCreated++;
    }

    r.exercises!.forEach((e, i) => {
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO routine_exercise (id, routine_id, exercise_id, position, target_sets, target_reps)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          routineId,
          nameToId.get(e.name!.trim().toLowerCase())!,
          i,
          e.targetSets ?? 3,
          e.targetReps ?? null,
        ),
      );
    });
    await c.env.DB.batch(stmts);
    resultRoutines.push({ id: routineId, name: r.name!.trim(), exercises: r.exercises!.length });
  }

  return c.json({ ok: true, summary, routines: resultRoutines }, 201);
});

// Map of lowercase exercise name -> id for the user's non-archived library.
async function buildExerciseIndex(env: Env, userId: string): Promise<Map<string, string>> {
  const rows = await env.DB.prepare(
    "SELECT id, name FROM exercise WHERE user_id = ? AND archived = 0",
  )
    .bind(userId)
    .all<{ id: string; name: string }>();
  const map = new Map<string, string>();
  for (const r of rows.results ?? []) map.set(r.name.trim().toLowerCase(), r.id);
  return map;
}

const SCHEMA_DOC = {
  description:
    "Paste a JSON workout plan in this shape to import it. Exercises are matched to your library by name (case-insensitive) and created if new. Routines are matched by name and updated if one already exists.",
  schema: {
    routines: [
      {
        name: "string (required)",
        notes: "string (optional)",
        exercises: [
          {
            name: "string (required)",
            kind: "'lift' | 'cardio' (optional, default lift)",
            muscleGroup: "string (optional)",
            unit: "string (optional, default 'lbs' / 'mi' for cardio)",
            progressionStep: "number (optional, default 5)",
            isFavorite: "boolean (optional)",
            targetSets: "number (optional, default 3)",
            targetReps: "number (optional)",
          },
        ],
      },
    ],
  },
  example: {
    routines: [
      {
        name: "Full Body A",
        notes: "~2 hours, balanced full-body",
        exercises: [
          { name: "Barbell Back Squat", muscleGroup: "legs", unit: "lbs", progressionStep: 10, targetSets: 4, targetReps: 6 },
          { name: "Barbell Bench Press", muscleGroup: "chest", targetSets: 4, targetReps: 6 },
          { name: "Barbell Row", muscleGroup: "back", targetSets: 4, targetReps: 8 },
          { name: "Overhead Press", muscleGroup: "shoulders", targetSets: 3, targetReps: 8 },
          { name: "Romanian Deadlift", muscleGroup: "hamstrings", targetSets: 3, targetReps: 10 },
        ],
      },
    ],
  },
};

export default imp;
