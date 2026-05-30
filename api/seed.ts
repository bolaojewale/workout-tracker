// Starter exercise library inserted on first registration so the app is usable
// immediately. Favorites mirror the sheet's "top 4 main lifts".
import type { Env } from "./index";

interface SeedExercise {
  name: string;
  kind: "lift" | "cardio";
  muscleGroup: string | null;
  unit: string;
  favorite?: boolean;
  step?: number;
}

const STARTER: SeedExercise[] = [
  { name: "Barbell Bench Press", kind: "lift", muscleGroup: "chest", unit: "lbs", favorite: true, step: 5 },
  { name: "Barbell Back Squat", kind: "lift", muscleGroup: "legs", unit: "lbs", favorite: true, step: 10 },
  { name: "Barbell Deadlift", kind: "lift", muscleGroup: "back", unit: "lbs", favorite: true, step: 10 },
  { name: "Barbell Row", kind: "lift", muscleGroup: "back", unit: "lbs", favorite: true, step: 5 },
  { name: "Overhead Press", kind: "lift", muscleGroup: "shoulders", unit: "lbs", step: 5 },
  { name: "Romanian Deadlift", kind: "lift", muscleGroup: "hamstrings", unit: "lbs", step: 5 },
  { name: "Pull-up", kind: "lift", muscleGroup: "back", unit: "lbs", step: 5 },
  { name: "Dumbbell Curl", kind: "lift", muscleGroup: "arms", unit: "lbs", step: 5 },
  { name: "Running", kind: "cardio", muscleGroup: null, unit: "mi", step: 0 },
];

export async function seedExercises(env: Env, userId: string): Promise<void> {
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO exercise
       (id, user_id, name, kind, muscle_group, default_sets, is_favorite, unit, progression_step, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const batch = STARTER.map((e) =>
    stmt.bind(
      crypto.randomUUID(),
      userId,
      e.name,
      e.kind,
      e.muscleGroup,
      e.kind === "cardio" ? 1 : 3,
      e.favorite ? 1 : 0,
      e.unit,
      e.step ?? 5,
      now,
    ),
  );
  await env.DB.batch(batch);
}
