"use client";

// Mark Attendance opening with no internet (public/sw.js). The service worker keeps a copy of the page when it is
// loaded in full, but faculty usually reach it from the menu (a client-side move the service worker never sees as a
// page load). So the page itself, whenever it is open with internet, stores its own HTML and every built file that
// HTML needs, in the same caches the service worker reads from. Best effort: any failure just means no offline copy.

const PAGE_CACHE = "fms-pages-v1";
const STATIC_CACHE = "fms-static-v1";

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  navigator.serviceWorker.register("/sw.js").catch(() => { /* unsupported / blocked: the app works as before */ });
}

export async function keepPageForOffline(path: string): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window) || !navigator.onLine) return;
  try {
    const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok || res.redirected || !(res.headers.get("content-type") ?? "").includes("text/html")) return;
    const html = await res.clone().text();
    await (await caches.open(PAGE_CACHE)).put(path, res);
    // Every built file the page loads (scripts, styles, fonts) - names are unique per release.
    const files = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s)<>\\]+/g)].map((m) => m[0]))];
    const statics = await caches.open(STATIC_CACHE);
    await Promise.all(files.map(async (f) => {
      if (await statics.match(f)) return;
      const r = await fetch(f).catch(() => null);
      if (r?.ok) await statics.put(f, r);
    }));
  } catch {
    // Storage blocked or full: no offline copy this time.
  }
}
