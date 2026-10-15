/* Keeps every page of the arcade up to date.

   1. Registers the service worker (sw.js at the site root), which revalidates every
      file with the server so a reload always gets the latest release.
   2. Notes the ETag (or Last-Modified date) of every file this page loaded, then
      checks them again every few minutes while the page is in view, and whenever you
      come back to it. If any has changed on the server, a small prompt offers to reload
      into the new version.

   Include it with a plain deferred script tag on every page:
     <script src="assets/update.js" defer></script>   (adjust the path) */

(() => {
  const me = document.currentScript;
  if (!me) return;
  const root = new URL('../', me.src);            // this file lives in <root>/assets/
  const EVERY = 5 * 60 * 1000;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('sw.js', root), { updateViaCache: 'none' })
      .catch(() => { /* file:// or a locked-down browser: carry on without */ });
  }

  const baseline = new Map();
  let lastCheck = 0, shown = false, busy = false;

  /* The page itself plus every script, stylesheet and page it pulled from this site. */
  function watched() {
    const out = new Set([location.href.split('#')[0]]);
    for (const e of performance.getEntriesByType('resource')) {
      let u;
      try { u = new URL(e.name); } catch { continue; }
      if (u.origin !== location.origin) continue;
      if (/\.(js|mjs|css|html|json|svg)$/.test(u.pathname) || u.pathname.endsWith('/')) out.add(u.href);
    }
    return [...out];
  }

  /* What the server says this file's version is right now. */
  async function token(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) return null;
      const t = r.headers.get('etag') || r.headers.get('last-modified');
      if (t) return t;
      // No validators at all: fall back to hashing the body.
      const g = await fetch(url, { cache: 'no-store' });
      const buf = await g.arrayBuffer();
      const d = await crypto.subtle.digest('SHA-1', buf);
      return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;                                 // offline, or the file went away
    }
  }

  async function check() {
    if (busy || shown) return false;
    busy = true;
    lastCheck = Date.now();
    let changed = false;
    try {
      for (const url of watched()) {
        const t = await token(url);
        if (t === null) continue;
        if (!baseline.has(url)) { baseline.set(url, t); continue; }
        if (baseline.get(url) !== t) { changed = true; break; }
      }
    } finally { busy = false; }
    if (changed) prompt();
    return changed;
  }

  function prompt() {
    if (shown) return;
    shown = true;
    const css = document.createElement('style');
    css.textContent = `
      .arcade-update{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 16px);
        transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:10px;
        padding:8px 8px 8px 16px;border-radius:999px;background:#13233a;color:#fff;
        font:600 13.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
        box-shadow:0 10px 30px rgba(0,0,0,.3);white-space:nowrap;animation:arcade-up .35s ease}
      .arcade-update button{border:0;border-radius:999px;cursor:pointer;font:inherit}
      .arcade-update .go{background:#57c8ff;color:#04121f;padding:8px 14px;font-weight:800}
      .arcade-update .no{background:transparent;color:rgba(255,255,255,.6);padding:8px 6px;font-size:16px;line-height:1}
      @keyframes arcade-up{from{opacity:0;transform:translate(-50%,12px)}}`;
    const bar = document.createElement('div');
    bar.className = 'arcade-update';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>A new version is ready</span>' +
      '<button class="go" type="button">Reload</button>' +
      '<button class="no" type="button" aria-label="Not now">×</button>';
    bar.querySelector('.go').addEventListener('click', reload);
    bar.querySelector('.no').addEventListener('click', () => bar.remove());
    // Keep taps on the prompt from reaching a game underneath it.
    for (const ev of ['pointerdown', 'touchstart', 'mousedown']) bar.addEventListener(ev, e => e.stopPropagation());
    document.head.appendChild(css);
    document.body.appendChild(bar);
  }

  async function reload() {
    // Drop the offline copies too, so nothing old can be served even if the network
    // hiccups during the reload. The service worker refills them as files arrive.
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* no Cache Storage */ }
    location.reload();
  }

  // First look a few seconds after load, once the page has fetched what it needs.
  window.addEventListener('load', () => setTimeout(check, 4000));
  setInterval(() => { if (!document.hidden) check(); }, EVERY);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheck > 60 * 1000) check();
  });

  window.arcadeUpdate = { check, prompt };
})();
