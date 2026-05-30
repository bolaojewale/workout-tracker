// Monthly check-in CRUD: body measurements, bodyweight, 1-mile time trial,
// compound-lift tests. Photos (R2) are added once R2 is enabled. See DESIGN.md §6.
import { Hono } from "hono";
import type { AppEnv, Env } from "./index";
import { requireAuth } from "./auth";
import type { Checkin, CheckinLift } from "../shared/types";

interface CheckinRow {
  id: string;
  date: string;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  arms: number | null;
  thighs: number | null;
  forearms: number | null;
  body_weight: number | null;
  mile_time_sec: number | null;
  notes: string | null;
}

async function loadCheckin(env: Env, userId: string, id: string): Promise<Checkin | null> {
  const r = await env.DB.prepare("SELECT * FROM checkin WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<CheckinRow>();
  if (!r) return null;
  const lifts = await env.DB.prepare(
    "SELECT id, exercise_id, weight, reps FROM checkin_lift WHERE checkin_id = ?",
  )
    .bind(id)
    .all<{ id: string; exercise_id: string; weight: number | null; reps: number | null }>();
  return toCheckin(r, lifts.results ?? []);
}

function toCheckin(
  r: CheckinRow,
  lifts: { id: string; exercise_id: string; weight: number | null; reps: number | null }[],
): Checkin {
  return {
    id: r.id,
    date: r.date,
    chest: r.chest,
    waist: r.waist,
    hips: r.hips,
    arms: r.arms,
    thighs: r.thighs,
    forearms: r.forearms,
    bodyWeight: r.body_weight,
    mileTimeSec: r.mile_time_sec,
    notes: r.notes,
    lifts: lifts.map(
      (l): CheckinLift => ({
        id: l.id,
        exerciseId: l.exercise_id,
        weight: l.weight,
        reps: l.reps,
      }),
    ),
  };
}

type CheckinInput = Partial<Omit<Checkin, "id" | "lifts">> & {
  lifts?: { exerciseId: string; weight: number | null; reps: number | null }[];
};

function liftStatements(env: Env, checkinId: string, lifts: NonNullable<CheckinInput["lifts"]>) {
  const insert = env.DB.prepare(
    "INSERT INTO checkin_lift (id, checkin_id, exercise_id, weight, reps) VALUES (?, ?, ?, ?, ?)",
  );
  return lifts.map((l) =>
    insert.bind(crypto.randomUUID(), checkinId, l.exerciseId, l.weight ?? null, l.reps ?? null),
  );
}

const checkins = new Hono<AppEnv>();
checkins.use("*", requireAuth);

checkins.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id FROM checkin WHERE user_id = ? ORDER BY date DESC",
  )
    .bind(c.get("userId"))
    .all<{ id: string }>();
  const list = await Promise.all(
    (rows.results ?? []).map((r) => loadCheckin(c.env, c.get("userId"), r.id)),
  );
  return c.json(list.filter(Boolean));
});

checkins.post("/", async (c) => {
  const b = await c.req.json<CheckinInput>();
  const id = crypto.randomUUID();
  const date = b.date ?? new Date().toISOString().slice(0, 10);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO checkin (id, user_id, date, chest, waist, hips, arms, thighs, forearms, body_weight, mile_time_sec, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      c.get("userId"),
      date,
      b.chest ?? null,
      b.waist ?? null,
      b.hips ?? null,
      b.arms ?? null,
      b.thighs ?? null,
      b.forearms ?? null,
      b.bodyWeight ?? null,
      b.mileTimeSec ?? null,
      b.notes ?? null,
    ),
    ...liftStatements(c.env, id, b.lifts ?? []),
  ]);
  return c.json(await loadCheckin(c.env, c.get("userId"), id), 201);
});

checkins.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM checkin WHERE id = ? AND user_id = ?")
    .bind(id, c.get("userId"))
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "not found" }, 404);

  const b = await c.req.json<CheckinInput>();
  const fields: Record<string, unknown> = {
    date: b.date,
    chest: b.chest,
    waist: b.waist,
    hips: b.hips,
    arms: b.arms,
    thighs: b.thighs,
    forearms: b.forearms,
    body_weight: b.bodyWeight,
    mile_time_sec: b.mileTimeSec,
    notes: b.notes,
  };
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  const stmts = [];
  if (entries.length) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE checkin SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
      ).bind(...entries.map(([, v]) => v), id),
    );
  }
  if (b.lifts !== undefined) {
    stmts.push(c.env.DB.prepare("DELETE FROM checkin_lift WHERE checkin_id = ?").bind(id));
    stmts.push(...liftStatements(c.env, id, b.lifts));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(await loadCheckin(c.env, c.get("userId"), id));
});

checkins.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM checkin WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

export default checkins;
