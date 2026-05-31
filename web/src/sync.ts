// Offline-capable mutations + replay queue (DESIGN.md §8).
//
// mutate(): send immediately when possible; on network failure, queue the
// mutation (with a stable mutationId) and resolve optimistically. The UI has
// already updated its in-memory state, so the user keeps logging uninterrupted.
//
// replay(): on reconnect/startup, flush the queue in order. The server's
// X-Mutation-Id guard makes re-applied mutations no-ops.
import { enqueue, allQueued, dequeue, queueCount } from "./store";

// Save-status the UI can show. "saving" = a write is in flight or queued work
// is draining; "saved" = a write just settled (brief confirmation); "idle" =
// nothing pending; "offline-queued" = writes are waiting for a connection.
export type SaveState = "idle" | "saving" | "saved" | "offline-queued";

type Listener = (pending: number) => void;
type SaveListener = (state: SaveState, pending: number) => void;
const listeners = new Set<Listener>();
const saveListeners = new Set<SaveListener>();
let replaying = false;
let inFlight = 0; // writes currently being sent
let savedTimer: ReturnType<typeof setTimeout> | undefined;

export function onPendingChange(fn: Listener) {
  listeners.add(fn);
}
export function onSaveStateChange(fn: SaveListener) {
  saveListeners.add(fn);
}

async function notify() {
  const n = await queueCount();
  listeners.forEach((fn) => fn(n));
  await emitSaveState(n);
}

// Derive and broadcast the save state from in-flight + queued counts.
async function emitSaveState(pending?: number) {
  const n = pending ?? (await queueCount());
  let state: SaveState;
  if (inFlight > 0) state = "saving";
  else if (n > 0) state = navigator.onLine ? "saving" : "offline-queued";
  else state = "idle";
  saveListeners.forEach((fn) => fn(state, n));
}

// Briefly flash "saved" after a write settles with nothing else pending.
async function flashSaved() {
  if (inFlight > 0) return;
  const n = await queueCount();
  if (n > 0) return;
  saveListeners.forEach((fn) => fn("saved", 0));
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => emitSaveState(0), 1500);
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
  inFlight++;
  emitSaveState();
  try {
    if (navigator.onLine && (await send(method, path, body, mutationId))) {
      inFlight--;
      await flashSaved();
      return;
    }
  } catch {
    /* fall through to queue */
  }
  inFlight--;
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
    await flashSaved(); // confirm once the queue has drained
  }
}

export function initSync() {
  window.addEventListener("online", replay);
  replay();
  notify();
}
