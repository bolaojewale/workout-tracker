import { Hono } from "hono";
import { estimatedOneRepMax } from "../shared/types";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  RP_ID?: string;
  ORIGIN?: string;
}

const app = new Hono<{ Bindings: Env }>();

// --- API routes -----------------------------------------------------------
const api = new Hono<{ Bindings: Env }>();

api.get("/health", (c) =>
  c.json({ ok: true, service: "workout-tracker", time: Date.now() }),
);

// Quick sanity endpoint: confirms D1 binding works once a DB is bound.
api.get("/health/db", async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ db: row?.ok === 1 });
  } catch (err) {
    return c.json({ db: false, error: String(err) }, 500);
  }
});

// Example of shared logic wired through; replaced by real stats later.
api.get("/calc/1rm", (c) => {
  const weight = Number(c.req.query("weight"));
  const reps = Number(c.req.query("reps"));
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) {
    return c.json({ error: "weight and reps required" }, 400);
  }
  return c.json({ oneRepMax: estimatedOneRepMax(weight, reps) });
});

app.route("/api", api);

// --- Static assets + SPA fallback -----------------------------------------
// Everything not under /api is served from the built PWA (web/dist). Unknown
// paths fall back to index.html so client-side routing works.
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
