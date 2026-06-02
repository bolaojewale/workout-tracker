// Nutrition: a reusable meal library (like routines, but macros) and a per-day
// meal log. All routes require auth and are user-scoped.
import { Hono } from "hono";
import type { AppEnv } from "./index";
import { requireAuth } from "./auth";
import type { Meal, MealLogEntry } from "../shared/types";

interface MealRow {
  id: string;
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  archived: number;
}
interface MealLogRow {
  id: string;
  date: string;
  meal_id: string | null;
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  position: number;
}

const toMeal = (r: MealRow): Meal => ({
  id: r.id,
  name: r.name,
  protein: r.protein,
  carbs: r.carbs,
  fat: r.fat,
  archived: !!r.archived,
});
const toLog = (r: MealLogRow): MealLogEntry => ({
  id: r.id,
  date: r.date,
  mealId: r.meal_id,
  name: r.name,
  protein: r.protein,
  carbs: r.carbs,
  fat: r.fat,
  position: r.position,
});

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

// ---------- Meal library ----------
export const meals = new Hono<AppEnv>();
meals.use("*", requireAuth);

meals.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM meal WHERE user_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE",
  )
    .bind(c.get("userId"))
    .all<MealRow>();
  return c.json((rows.results ?? []).map(toMeal));
});

meals.post("/", async (c) => {
  const b = await c.req.json<Partial<Meal>>();
  if (!b.name?.trim()) return c.json({ error: "name is required" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO meal (id, user_id, name, protein, carbs, fat, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
  )
    .bind(id, c.get("userId"), b.name.trim(), num(b.protein), num(b.carbs), num(b.fat), Date.now())
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM meal WHERE id = ?").bind(id).first<MealRow>();
  return c.json(toMeal(row!), 201);
});

meals.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM meal WHERE id = ? AND user_id = ?")
    .bind(id, c.get("userId"))
    .first<MealRow>();
  if (!existing) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<Partial<Meal>>();
  await c.env.DB.prepare("UPDATE meal SET name = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?")
    .bind(
      b.name?.trim() ?? existing.name,
      b.protein ?? existing.protein,
      b.carbs ?? existing.carbs,
      b.fat ?? existing.fat,
      id,
    )
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM meal WHERE id = ?").bind(id).first<MealRow>();
  return c.json(toMeal(row!));
});

meals.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare("UPDATE meal SET archived = 1 WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ---------- Per-day meal log ----------
export const mealLog = new Hono<AppEnv>();
mealLog.use("*", requireAuth);

mealLog.get("/", async (c) => {
  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM meal_log WHERE user_id = ? AND date = ? ORDER BY position, created_at",
  )
    .bind(c.get("userId"), date)
    .all<MealLogRow>();
  return c.json((rows.results ?? []).map(toLog));
});

mealLog.post("/", async (c) => {
  const b = await c.req.json<Partial<MealLogEntry> & { id?: string }>();
  const date = b.date ?? new Date().toISOString().slice(0, 10);
  // Resolve macros: from the library meal if mealId given, else from the body.
  let name = b.name?.trim() ?? "";
  let protein = num(b.protein);
  let carbs = num(b.carbs);
  let fat = num(b.fat);
  if (b.mealId) {
    const m = await c.env.DB.prepare("SELECT * FROM meal WHERE id = ? AND user_id = ?")
      .bind(b.mealId, c.get("userId"))
      .first<MealRow>();
    if (!m) return c.json({ error: "meal not found" }, 404);
    name = name || m.name;
    if (b.protein === undefined) protein = m.protein;
    if (b.carbs === undefined) carbs = m.carbs;
    if (b.fat === undefined) fat = m.fat;
  }
  if (!name) name = "Meal";

  const posRow = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM meal_log WHERE user_id = ? AND date = ?",
  )
    .bind(c.get("userId"), date)
    .first<{ pos: number }>();

  // Accept a client-supplied id so offline-created rows stay stable on replay.
  const id = b.id ?? crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO meal_log (id, user_id, date, meal_id, name, protein, carbs, fat, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, c.get("userId"), date, b.mealId ?? null, name, protein, carbs, fat, posRow?.pos ?? 0, Date.now())
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM meal_log WHERE id = ?").bind(id).first<MealLogRow>();
  return c.json(toLog(row!), 201);
});

mealLog.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM meal_log WHERE id = ? AND user_id = ?")
    .bind(id, c.get("userId"))
    .first<MealLogRow>();
  if (!existing) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<Partial<MealLogEntry>>();
  await c.env.DB.prepare(
    "UPDATE meal_log SET name = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?",
  )
    .bind(
      b.name?.trim() ?? existing.name,
      b.protein ?? existing.protein,
      b.carbs ?? existing.carbs,
      b.fat ?? existing.fat,
      id,
    )
    .run();
  return c.json({ ok: true });
});

mealLog.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM meal_log WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
