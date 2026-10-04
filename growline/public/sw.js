/*
 * Growline service worker. Two jobs:
 *  1. Make capture usable on a weak network (Section 4.3). Deliberately small: no
 *     precache manifest, no build step. Routes are cached as the coach visits them
 *     online, then served from cache when the network is gone. Actual submissions
 *     never go through here — those queue in IndexedDB.
 *  2. Receive follow-up reminders (F5) and open the right screen when tapped.
 */
const CACHE = "growline-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      // Evict any snapshot pages an earlier version of this worker stored before
      // /r/ was excluded, so upgrading actually removes them from disk.
      const cache = await caches.open(CACHE);
      const stale = (await cache.keys()).filter(
        (req) => new URL(req.url).pathname.startsWith("/r/")
      );
      await Promise.all(stale.map((req) => cache.delete(req)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload must still show something rather than nothing.
  }
  const title = payload.title || "Growline";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "You have follow-ups today.",
      // tag + renotify: today's reminder replaces yesterday's instead of stacking.
      tag: payload.tag || "growline",
      renotify: true,
      data: { url: payload.url || "/" },
      // No icon/badge yet — app icons are Phase 10 (Play Store assets). The browser
      // default is used rather than pointing at a file that isn't there.
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Reuse an open tab where possible — launching a second copy of the app on a
      // cheap phone is slow and disorienting.
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never serve a stale API response — auth and captures must always be live.
  if (url.pathname.startsWith("/api/")) return;
  /*
   * Never touch a wellness snapshot. The Cache API stores whatever it is given and
   * ignores Cache-Control, so caching /r/* would put another person's health
   * details on disk indefinitely — outliving the 90-day link expiry and surviving
   * that person asking for their data to be deleted.
   */
  if (url.pathname.startsWith("/r/")) return;

  // Hashed build assets are immutable: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Pages and RSC payloads: network-first, fall back to the last good copy.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        // `redirected` guards against caching a /login bounce under a real path.
        if (res.ok && !res.redirected) {
          (await caches.open(CACHE)).put(req, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          return new Response(
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>" +
              "<div style=\"font:16px/1.5 system-ui;padding:2rem;text-align:center\">" +
              "<h1 style='font-size:1.25rem'>You're offline</h1>" +
              "<p>Open this screen once with network, then it will work offline.</p></div>",
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
          );
        }
        throw err;
      }
    })()
  );
});
