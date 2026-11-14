/* Vishnu People - service worker: lets Mark Attendance open with no internet.
 *
 * Only two kinds of request are handled; everything else (every /api call, every other page) goes to the network
 * exactly as without a service worker:
 *  - the Mark Attendance page itself: network first (always the latest when online), and a copy kept so the page
 *    opens from it when there is no network;
 *  - the app's built files under /_next/static/ (names change with every release, so a copy never goes stale):
 *    from the copy when present, else the network (and kept).
 * The page's data (classes, student lists, the queue) is kept by the page itself (offlineDayCache / offline queue).
 */
const PAGE_CACHE = "fms-pages-v1";
const STATIC_CACHE = "fms-static-v1";
const OFFLINE_PAGES = ["/panel/mark-attendance"];
const STATIC_LIMIT = 600;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([PAGE_CACHE, STATIC_CACHE]);
    for (const name of await caches.keys()) if (name.startsWith("fms-") && !keep.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

const isOfflinePage = (url) => OFFLINE_PAGES.includes(url.pathname.replace(/\/$/, ""));

async function trimStatic() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - STATIC_LIMIT; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The Mark Attendance page (a full page load, not a client-side data request).
  if (req.mode === "navigate" && isOfflinePage(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      try {
        const res = await fetch(req);
        // Keep only a real page (not a redirect to sign in, not an error).
        if (res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html")) {
          await cache.put(url.pathname, res.clone());
        }
        return res;
      } catch {
        const copy = await cache.match(url.pathname);
        if (copy) return copy;
        return new Response(
          "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>No Internet</title>" +
          "<body style='font-family:system-ui;padding:24px;line-height:1.5'><h2>No internet connection</h2>" +
          "<p>Mark Attendance has not been opened on this phone with internet yet. Open it once with internet; after that it opens without a connection.</p></body>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
    })());
    return;
  }

  // Built app files: names are unique per release.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const copy = await cache.match(req);
      if (copy) return copy;
      const res = await fetch(req);
      if (res.ok) { await cache.put(req, res.clone()); trimStatic(); }
      return res;
    })());
  }
});
