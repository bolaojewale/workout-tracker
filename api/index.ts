import { Hono } from "hono";
import { estimatedOneRepMax } from "../shared/types";
import {
  hashPassword,
  verifyPassword,
  issueSession,
  clearSession,
  getUserId,
  requireAuth,
} from "./auth";
import { seedExercises } from "./seed";
import exercises from "./exercises";
import routines from "./routines";
import sessions, { setRoutes } from "./sessions";
import stats from "./stats";
import summary from "./summary";
import checkins from "./checkins";

export interface Env {
  DB: D1Database;
  PHOTOS?: R2Bucket; // enabled in roadmap step 6 (progress photos)
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  RP_ID?: string;
  ORIGIN?: string;
}

export type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

// --- API routes -----------------------------------------------------------
const api = new Hono<AppEnv>();

// Idempotency guard for offline replay (DESIGN.md §8): a mutation carrying an
// X-Mutation-Id that's already been applied is acknowledged without re-running.
// Successful new mutations record their id so replays are no-ops.
api.use("*", async (c, next) => {
  if (c.req.method === "GET") return next();
  const mid = c.req.header("X-Mutation-Id");
  if (!mid) return next();
  const seen = await c.env.DB.prepare("SELECT 1 AS ok FROM applied_mutation WHERE id = ?")
    .bind(mid)
    .first();
  if (seen) return c.json({ ok: true, duplicate: true });
  await next();
  if (c.res.status >= 200 && c.res.status < 300) {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO applied_mutation (id, applied_at) VALUES (?, ?)",
    )
      .bind(mid, Date.now())
      .run();
  }
});

api.get("/health", (c) =>
  c.json({ ok: true, service: "workout-tracker", time: Date.now() }),
);

api.get("/health/db", async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ db: row?.ok === 1 });
  } catch (err) {
    return c.json({ db: false, error: String(err) }, 500);
  }
});

// --- Auth (public) --------------------------------------------------------
// Single-user model: registration is allowed only until the one user exists.
async function userCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM user").first<{
    n: number;
  }>();
  return row?.n ?? 0;
}

api.get("/auth/status", async (c) => {
  const registered = (await userCount(c.env)) > 0;
  const authenticated = (await getUserId(c)) !== null;
  return c.json({ registered, authenticated });
});

api.post("/auth/register", async (c) => {
  if ((await userCount(c.env)) > 0) {
    return c.json({ error: "already registered" }, 409);
  }
  const body = await c.req.json<{
    email?: string;
    displayName?: string;
    password?: string;
  }>();
  const password = body.password ?? "";
  if (password.length < 8) {
    return c.json({ error: "password must be at least 8 characters" }, 400);
  }

  const userId = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO user (id, email, display_name, units, created_at)
     VALUES (?, ?, ?, 'imperial', ?)`,
  )
    .bind(userId, body.email ?? null, body.displayName ?? null, now)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO credential (id, user_id, type, password_hash, created_at)
     VALUES (?, ?, 'password', ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, await hashPassword(password), now)
    .run();

  await seedExercises(c.env, userId);
  await issueSession(c, userId);
  return c.json({ ok: true });
});

api.post("/auth/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const password = body.password ?? "";

  // Single user: match by email if provided, else just take the one user.
  const user = body.email
    ? await c.env.DB.prepare("SELECT id FROM user WHERE email = ?")
        .bind(body.email)
        .first<{ id: string }>()
    : await c.env.DB.prepare("SELECT id FROM user LIMIT 1").first<{ id: string }>();
  if (!user) return c.json({ error: "invalid credentials" }, 401);

  const cred = await c.env.DB.prepare(
    "SELECT password_hash FROM credential WHERE user_id = ? AND type = 'password'",
  )
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!cred?.password_hash || !(await verifyPassword(password, cred.password_hash))) {
    return c.json({ error: "invalid credentials" }, 401);
  }

  await issueSession(c, user.id);
  return c.json({ ok: true });
});

api.post("/auth/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

// --- Authenticated routes -------------------------------------------------
api.use("/me", requireAuth);
api.get("/me", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, email, display_name, units FROM user WHERE id = ?",
  )
    .bind(c.get("userId"))
    .first<{ id: string; email: string | null; display_name: string | null; units: string }>();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    units: row.units,
  });
});

api.get("/calc/1rm", (c) => {
  const weight = Number(c.req.query("weight"));
  const reps = Number(c.req.query("reps"));
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) {
    return c.json({ error: "weight and reps required" }, 400);
  }
  return c.json({ oneRepMax: estimatedOneRepMax(weight, reps) });
});

api.route("/exercises", exercises);
api.route("/routines", routines);
api.route("/sessions", sessions);
api.route("/stats", stats);
api.route("/summary", summary);
api.route("/checkins", checkins);
api.route("/", setRoutes); // /session-exercises/:id, /sets/:id

app.route("/api", api);

// --- Static assets + SPA fallback -----------------------------------------
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status === 404) {
    const url = new URL(c.req.url);
    url.pathname = "/index.html";
    return c.env.ASSETS.fetch(new Request(url, c.req.raw));
  }
  return res;
});

export default app;
