// Service worker: plain JS, no build step. Served from the app's base path, so
// every URL is resolved relative to the worker's scope (works under /<repo>/).
const VERSION = "v2";
const CACHE = `resumen-${VERSION}`;
const MAX_DIGESTS = 7;

const scope = new URL(self.registration.scope);
const rel = (p) => new URL(p, scope).href;
const DIGEST_FILE = /\/digests\/(\d{4}-\d{2}-\d{2})\.json$/;

// Pure helper: given cached request URLs, return the digest URLs to evict
// (everything but the newest `keep` dated digests).
function digestsToPrune(urls, keep = MAX_DIGESTS) {
  return urls
    .map((u) => ({ u, m: DIGEST_FILE.exec(new URL(u).pathname) }))
    .filter((x) => x.m)
    .sort((a, b) => (a.m[1] < b.m[1] ? 1 : a.m[1] > b.m[1] ? -1 : 0))
    .slice(keep)
    .map((x) => x.u);
}

async function pruneDigests(cache) {
  const keys = await cache.keys();
  for (const url of digestsToPrune(keys.map((r) => r.url))) await cache.delete(url);
}

// Best-effort: cache the shell, the built asset files it references, and the latest digest.
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll([rel("./"), rel("manifest.webmanifest"), rel("icons/icon-192.png"), rel("icons/icon-512.png")]);
  try {
    const html = await (await cache.match(rel("./"))).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+|\.?\/?assets\/[^"]+)"/g)].map((m) =>
      new URL(m[1], scope).href,
    );
    await Promise.allSettled(assets.map((a) => cache.add(a)));
    const res = await fetch(rel("digests/index.json"), { cache: "no-store" });
    if (res.ok) {
      await cache.put(rel("digests/index.json"), res.clone());
      const { latest } = await res.json();
      if (latest) await cache.add(rel(`digests/${latest}.json`));
    }
  } catch {
    // Offline or unexpected markup: runtime caching will fill in later.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("resumen-") && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cacheKey, afterPut) {
  const cache = await caches.open(CACHE);
  try {
    // GitHub Pages sends max-age=600; bypass the HTTP cache so we always hit the network.
    const res = await fetch(request, { cache: "no-store" });
    if (res.ok) {
      await cache.put(cacheKey, res.clone());
      if (afterPut) await afterPut(cache);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((res) => {
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.href.startsWith(scope.href)) return;

  if (request.mode === "navigate") {
    // Offline navigation falls back to the cached app shell.
    event.respondWith(networkFirst(request, rel("./")));
  } else if (url.pathname.includes("/digests/")) {
    event.respondWith(networkFirst(request, request, pruneDigests));
  } else if (url.pathname.includes("/assets/")) {
    // Vite emits content-hashed filenames here, so cached copies never go stale.
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});
