/* Keeps every page of the arcade up to date, with no service worker and no version
   number to bump.

   A few seconds after load, and then every few minutes while the page is in view (and
   whenever you come back to it), it compares two versions of every file the page uses
   from this site: the copy this browser has (its ETag or Last-Modified date, read
   straight from the HTTP cache) and the one on the server now. If any differ, a small
   prompt offers to reload. Reloading first re-downloads each of those files into the
   cache, so nothing stale survives the reload.

   Include it with a plain deferred script tag on every page:
     <script src="assets/update.js" defer></script>   (adjust the path) */

(() => {
  const EVERY = 5 * 60 * 1000;
  let lastCheck = 0, shown = false, busy = false;

  // An earlier version of the arcade installed a service worker that could break
  // Safari. Make sure none is left behind.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister()))
      .catch(() => {});
  }

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

  function stamp(r) {
    return r && r.ok ? (r.headers.get('etag') || r.headers.get('last-modified')) : null;
  }

  /* Is the copy this browser holds of `url` the same as the server's? */
  async function same(url) {
    try {
      const [mine, theirs] = await Promise.all([
        fetch(url, { cache: 'force-cache' }),                  // what we have
        fetch(url, { method: 'HEAD', cache: 'no-store' })      // what is out there
      ]);
      const a = stamp(mine), b = stamp(theirs);
      return !a || !b || a === b;                              // unknown counts as same
    } catch {
      return true;                                             // offline: nothing to say
    }
  }

  async function check() {
    if (busy || shown) return false;
    busy = true;
    lastCheck = Date.now();
    let changed = false;
    try {
      for (const url of watched()) {
        if (!(await same(url))) { changed = true; break; }
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
    bar.querySelector('.go').addEventListener('click', () => {
      bar.querySelector('span').textContent = 'Updating…';
      refresh();
    });
    bar.querySelector('.no').addEventListener('click', () => bar.remove());
    // Keep taps on the prompt from reaching a game underneath it.
    for (const ev of ['pointerdown', 'touchstart', 'mousedown']) bar.addEventListener(ev, e => e.stopPropagation());
    document.head.appendChild(css);
    document.body.appendChild(bar);
  }

  /* Pull a fresh copy of every file into the browser's cache, then reload onto them. */
  async function refresh() {
    try {
      await Promise.all(watched().map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
    } catch { /* reload anyway */ }
    location.reload();
  }

  window.addEventListener('load', () => setTimeout(check, 4000));
  setInterval(() => { if (!document.hidden) check(); }, EVERY);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheck > 60 * 1000) check();
  });

  window.arcadeUpdate = { check, prompt, refresh };
})();
