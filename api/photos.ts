// Progress photos: upload to R2, list/serve/delete metadata in D1.
// Photos are linked to a monthly check-in. See DESIGN.md §4, §6.
import { Hono } from "hono";
import type { AppEnv } from "./index";
import { requireAuth } from "./auth";

const photos = new Hono<AppEnv>();
photos.use("*", requireAuth);

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

interface PhotoRow {
  id: string;
  checkin_id: string | null;
  r2_key: string;
  angle: string | null;
  taken_at: number;
}

async function ownsCheckin(c: AppEnv["Bindings"], userId: string, checkinId: string) {
  const row = await c.DB.prepare("SELECT 1 AS ok FROM checkin WHERE id = ? AND user_id = ?")
    .bind(checkinId, userId)
    .first<{ ok: number }>();
  return !!row;
}

// List a check-in's photos (metadata only; images via GET /:id).
photos.get("/checkin/:checkinId", async (c) => {
  const userId = c.get("userId");
  const checkinId = c.req.param("checkinId");
  if (!(await ownsCheckin(c.env, userId, checkinId))) return c.json({ error: "not found" }, 404);
  const rows = await c.env.DB.prepare(
    "SELECT id, checkin_id, r2_key, angle, taken_at FROM photo WHERE user_id = ? AND checkin_id = ? ORDER BY taken_at",
  )
    .bind(userId, checkinId)
    .all<PhotoRow>();
  return c.json(
    (rows.results ?? []).map((p) => ({
      id: p.id,
      checkinId: p.checkin_id,
      angle: p.angle,
      takenAt: p.taken_at,
      url: `/api/photos/${p.id}`,
    })),
  );
});

// Upload: raw image body. ?checkinId=&angle=front|side|back
photos.post("/", async (c) => {
  const userId = c.get("userId");
  const checkinId = c.req.query("checkinId");
  const angle = c.req.query("angle") ?? null;
  if (!checkinId || !(await ownsCheckin(c.env, userId, checkinId))) {
    return c.json({ error: "valid checkinId required" }, 400);
  }
  const contentType = c.req.header("Content-Type") ?? "";
  if (!ALLOWED.has(contentType)) {
    return c.json({ error: "unsupported image type" }, 415);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty body" }, 400);
  if (body.byteLength > MAX_BYTES) return c.json({ error: "image too large (max 12MB)" }, 413);

  const id = crypto.randomUUID();
  const key = `${userId}/${checkinId}/${id}`;
  await c.env.PHOTOS.put(key, body, { httpMetadata: { contentType } });
  await c.env.DB.prepare(
    "INSERT INTO photo (id, user_id, checkin_id, r2_key, angle, taken_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, userId, checkinId, key, angle, Date.now())
    .run();
  return c.json({ id, checkinId, angle, takenAt: Date.now(), url: `/api/photos/${id}` }, 201);
});

// Serve the image bytes (auth-guarded; only the owner can read).
photos.get("/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT r2_key FROM photo WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), c.get("userId"))
    .first<{ r2_key: string }>();
  if (!row) return c.json({ error: "not found" }, 404);
  const obj = await c.env.PHOTOS.get(row.r2_key);
  if (!obj) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=31536000");
  headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

photos.delete("/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT r2_key FROM photo WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), c.get("userId"))
    .first<{ r2_key: string }>();
  if (!row) return c.json({ error: "not found" }, 404);
  await c.env.PHOTOS.delete(row.r2_key);
  await c.env.DB.prepare("DELETE FROM photo WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default photos;
