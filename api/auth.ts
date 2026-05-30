// Single-user auth: PBKDF2 password hashing (Web Crypto, no deps) + stateless
// HMAC-signed session cookies. See DESIGN.md §2 (auth) and §6.
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, AppEnv } from "./index";

const COOKIE = "wt_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

// --- base64url helpers -----------------------------------------------------
function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- password hashing ------------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64url(salt)}$${toB64url(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const salt = fromB64url(saltB64);
  const hash = await pbkdf2(password, salt, Number(iterStr));
  return timingSafeEqual(toB64url(hash), hashB64);
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

// --- signed session cookies ------------------------------------------------
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toB64url(new Uint8Array(sig));
}

function sessionSecret(env: Env): string {
  // Required in production. A dev fallback keeps `wrangler dev` usable without
  // a secret, but logs a warning so it's never relied on in deployment.
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  console.warn("SESSION_SECRET not set — using insecure dev fallback");
  return "dev-insecure-secret-change-me";
}

export async function issueSession(c: Context<AppEnv>, userId: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `${userId}.${exp}`;
  const sig = await hmac(sessionSecret(c.env), payload);
  setCookie(c, COOKIE, `${payload}.${sig}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSession(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function getUserId(
  c: Context<AppEnv>,
): Promise<string | null> {
  const raw = getCookie(c, COOKIE);
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = await hmac(sessionSecret(c.env), payload);
  if (!timingSafeEqual(sig, expected)) return null;
  const [userId, expStr] = payload.split(".");
  if (!userId || Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return userId;
}

// Hono middleware: 401 unless a valid session is present. Stashes userId.
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
}
