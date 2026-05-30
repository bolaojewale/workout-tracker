// Tiny IndexedDB wrapper (no deps): a `queue` store for offline mutations and a
// `cache` store for last-known data so the app loads offline. See DESIGN.md §8.

const DB_NAME = "wt";
const DB_VERSION = 1;

export interface QueuedMutation {
  seq?: number; // autoIncrement key
  mutationId: string;
  method: string;
  path: string;
  body: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue"))
        db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("cache"))
        db.createObjectStore("cache", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// --- queue ---
export function enqueue(m: QueuedMutation): Promise<number> {
  return tx<IDBValidKey>("queue", "readwrite", (s) => s.add(m)).then(Number);
}
export function allQueued(): Promise<QueuedMutation[]> {
  return tx<QueuedMutation[]>("queue", "readonly", (s) => s.getAll());
}
export function dequeue(seq: number): Promise<void> {
  return tx("queue", "readwrite", (s) => s.delete(seq)).then(() => undefined);
}
export async function queueCount(): Promise<number> {
  return tx<number>("queue", "readonly", (s) => s.count());
}

// --- cache ---
export function cacheSet(key: string, value: unknown): Promise<void> {
  return tx("cache", "readwrite", (s) => s.put({ key, value })).then(() => undefined);
}
export async function cacheGet<T>(key: string): Promise<T | null> {
  const row = await tx<{ key: string; value: T } | undefined>(
    "cache",
    "readonly",
    (s) => s.get(key),
  );
  return row ? row.value : null;
}
