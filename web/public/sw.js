// Offline app-shell cache. The build hashes asset filenames, so the two halves
// are cached differently: hashed assets are immutable and kept forever, while
// the HTML naming them is fetched fresh. That ordering is what makes a deploy
// visible on the very next load instead of the one after it.
//
// Serving the shell from cache first (the old behaviour) pinned the whole app
// to the previous build: stale HTML names stale asset hashes, and those are
// cached too, so every deploy took two loads to appear.
//
// Bump CACHE whenever these rules change — activate() drops every other cache,
// and that is what flushes a stale shell.
const CACHE = "wt-shell-v2";
// "/index.html" is the single canonical shell entry: every successful
// navigation rewrites it, so the offline copy is always the newest one seen.
// Caching "/" separately would leave a second copy that nothing ever updates,
// and offline would serve whichever build happened to be installed first.
const SHELL = ["/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // Tolerate a shell entry we can't reach right now — it gets cached on demand
  // later. Letting install reject would strand the client on the old worker,
  // which is the exact failure this file is meant to fix.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((url) => c.add(url).catch(() => {})))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

function putInCache(key, response) {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches.open(CACHE).then((c) => c.put(key, copy));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls here; offline writes are handled by the sync queue.
  if (url.pathname.startsWith("/api/")) return;
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // HTML: network-first, cache as the offline fallback. Every SPA route serves
  // the same shell, so one canonical "/index.html" entry backs all of them.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          putInCache("/index.html", res);
          return res;
        })
        // Offline: the canonical shell first — it is the freshest build we have
        // seen. Only then the per-URL entry, for anything cached before this.
        .catch(() =>
          caches.match("/index.html").then((shell) => shell || caches.match(request)),
        ),
    );
    return;
  }

  // Hashed build assets are immutable: a content change produces a new
  // filename, so a cache hit can never be stale. Cache-first keeps loads fast.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            putInCache(request, res);
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (manifest, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          putInCache(request, res);
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
