/* Retired. An earlier service worker here could stop Safari loading the games' code.
   This version only removes itself: it takes over from the old one, deletes every
   cache it made, unregisters, and reloads any open page so it is served straight from
   the network. It has no fetch handler, so it never touches a request. Leave this file
   in place for a while so every browser that installed the old one gets cleaned up. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* nothing cached */ }
  try { await self.registration.unregister(); } catch { /* already gone */ }
  try {
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  } catch { /* no open pages */ }
})()));
