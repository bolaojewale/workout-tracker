// Types shared between the Worker API and the PWA frontend.
// Mirror the D1 schema in migrations/0001_init.sql.

export type Units = "imperial" | "metric";
export type ExerciseKind = "lift" | "cardio";
export type RunType = "easy" | "tempo" | "intervals" | "long" | "recovery";

export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  units: Units;
}

export interface Exercise {
  id: string;
  name: string;
  kind: ExerciseKind;
  muscleGroup: string | null;
  defaultSets: number;
  isFavorite: boolean;
  unit: string;
  progressionStep: number;
  archived: boolean;
}

export interface RoutineExercise {
  id: string;
  exerciseId: string;
  position: number;
  targetSets: number;
  targetReps: number | null;
}

export interface Routine {
  id: string;
  name: string;
  notes: string | null;
  archived: boolean;
  exercises: RoutineExercise[];
}

export interface SetEntry {
  id: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  isWarmup: boolean;
  completed: boolean;
  /** Set client-side when prefilled by the progression engine; cleared on edit. */
  suggested?: boolean;
}

export interface SessionExercise {
  id: string;
  exerciseId: string;
  position: number;
  rpe: number | null;
  sets: SetEntry[];
}

export interface RunBlock {
  distanceMi: number | null;
  durationSec: number | null;
  effort: number | null;
  runType: RunType | null;
}

export interface Session {
  id: string;
  date: string; // YYYY-MM-DD
  routineId: string | null;
  title: string | null;
  bodyWeight: number | null;
  sleepHours: number | null;
  energy: number | null;
  mood: number | null;
  proteinHit: boolean | null;
  calories: number | null;
  notes: string | null;
  completed: boolean;
  createdAt: number; // epoch ms; used for time-of-day labels when multiple/day
  exercises: SessionExercise[];
  run: RunBlock | null;
}

/** Wrapper for offline-replayable mutations. */
export interface Mutation<T = unknown> {
  mutationId: string;
  body: T;
}

/** Epley estimated 1RM. */
export function estimatedOneRepMax(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

export interface CheckinLift {
  id: string;
  exerciseId: string;
  weight: number | null;
  reps: number | null;
}

export interface Checkin {
  id: string;
  date: string; // YYYY-MM-DD
  chest: number | null;
  waist: number | null;
  hips: number | null;
  arms: number | null;
  thighs: number | null;
  forearms: number | null;
  bodyWeight: number | null;
  mileTimeSec: number | null;
  notes: string | null;
  lifts: CheckinLift[];
}
