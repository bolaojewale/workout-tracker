// Offline-capable mutations + replay queue (DESIGN.md §8).
//
// mutate(): send immediately when possible; on network failure, queue the
// mutation (with a stable mutationId) and resolve optimistically. The UI has
// already updated its in-memory state, so the user keeps logging uninterrupted.
//
// replay(): on reconnect/startup, flush the queue in order. The server's
// X-Mutation-Id guard makes re-applied mutations no-ops.
import { enqueue, allQueued, dequeue, queueCount } from "./store";

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();
let replaying = false;

export function onPendingChange(fn: Listener) {
  listeners.add(fn);
}
async function notify() {
  const n = await queueCount();
  listeners.forEach((fn) => fn(n));
}

// Returns true on a definitive server response (incl. 4xx), false on a network
// error (offline). 4xx is "definitive" — replaying it again won't help.
async function send(
  method: string,
  path: string,
  body: unknown,
  mutationId: string,
): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        "X-Mutation-Id": mutationId,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res.status < 500; // 2xx/4xx = stop retrying; 5xx = retry later
  } catch {
    return false; // network error → keep queued
  }
}

export async function mutate(method: string, path: string, body?: unknown): Promise<void> {
  const mutationId = crypto.randomUUID();
  if (navigator.onLine && (await send(method, path, body, mutationId))) return;
  await enqueue({ mutationId, method, path, body });
  await notify();
}

export async function replay(): Promise<void> {
  if (replaying || !navigator.onLine) return;
  replaying = true;
  try {
    const items = await allQueued();
    for (const m of items) {
      const ok = await send(m.method, m.path, m.body, m.mutationId);
      if (!ok) break; // offline again — stop, preserve order
      await dequeue(m.seq!);
      await notify();
    }
  } finally {
    replaying = false;
  }
}

export function initSync() {
  window.addEventListener("online", replay);
  replay();
  notify();
}
