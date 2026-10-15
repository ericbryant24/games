/* Service worker for the whole arcade. Network first, always revalidating with the
   server, so a new release is picked up on the very next load instead of whenever the
   browser's HTTP cache decides a file is stale. Everything fetched is also kept in
   Cache Storage, so a game you have played once still loads with no signal.

   It must never be the reason a page fails to load: anything that goes wrong in here
   falls back to a plain fetch, exactly as if there were no service worker at all.

   No version number to bump: the server's own ETags and Last-Modified dates decide
   what is new. assets/update.js watches those and offers a reload when they change. */

const CACHE = 'arcade-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  try {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  } catch { /* nothing to tidy */ }
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(respond(req).catch(() => fetch(req)));
});

async function respond(req) {
  let res;
  try {
    res = await fetch(revalidating(req));
  } catch (err) {
    // Offline, most likely: serve the last copy we have.
    const hit = await caches.match(req).catch(() => null);
    if (hit) return hit;
    throw err;
  }
  // A page load must not be answered with a redirected response (Safari refuses it);
  // send the browser to the final address instead.
  if (req.mode === 'navigate' && res.redirected) return Response.redirect(res.url, 302);
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    // Fire and forget — never hold the response up, never let a failure here matter.
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

/* The same request, but told to check with the server rather than trust the HTTP cache. */
function revalidating(req) {
  try {
    if (req.mode === 'navigate') return new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    return new Request(req, { cache: 'no-cache' });
  } catch {
    return req;
  }
}
