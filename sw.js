/* Service worker for the whole arcade. Network first, always revalidating with the
   server, so a new release is picked up on the very next load instead of whenever the
   browser's HTTP cache decides a file is stale. Everything fetched is also kept in
   Cache Storage, so a game you have played once still loads with no signal.

   No version number to bump: the server's own ETags and Last-Modified dates decide
   what is new. assets/update.js watches those and offers a reload when they change. */

const CACHE = 'arcade-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    // A navigation request cannot be copied with new options, so rebuild it from its URL.
    const fresh = req.mode === 'navigate'
      ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : new Request(req, { cache: 'no-cache' });
    try {
      const res = await fetch(fresh);
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      throw err;
    }
  })());
});
