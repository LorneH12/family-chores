// pwa-app core: storage, per-device usage (web link vs app), sync links, install button, hash router, escaping.
// App code calls PWA.init({ key, routes, sidebar }) and uses PWA.state / PWA.save / PWA.esc.
(function () {
  const PWA = window.PWA = {};
  PWA.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = s => document.querySelector(s);

  PWA.init = function ({ key, defaults = {}, routes = {}, home, sidebar, mergeApp }) {
    const S = PWA.state = Object.assign(structuredClone(defaults), { usage: {} }, JSON.parse(localStorage.getItem(key) || '{}'));
    PWA.save = () => localStorage.setItem(key, JSON.stringify(S));

    // ---- usage: device × how it was opened ----
    const coarse = matchMedia('(pointer:coarse)').matches;
    const device = coarse && Math.min(screen.width, screen.height) < 820 ? 'phone' : coarse ? 'tablet' : 'laptop';
    const mode = (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone) ? 'app' : 'browser';
    PWA.where = device + ' · ' + mode; PWA.mode = mode;
    const today = () => new Date().toISOString().slice(0, 10);
    const U = S.usage[PWA.where] = Object.assign({ visits: 0, minutes: 0, first: today(), last: today(), views: {}, width: 0 }, S.usage[PWA.where]);
    if (!sessionStorage.getItem(key + '-seen')) { sessionStorage.setItem(key + '-seen', '1'); U.visits++; }
    U.last = today(); U.width = innerWidth; PWA.save();
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      U.minutes = +(U.minutes + 0.25).toFixed(2);
      const view = (location.hash.slice(2).split('/')[0]) || 'home'; U.views[view] = +((U.views[view] || 0) + 0.25).toFixed(2); PWA.save();
    }, 15000);
    PWA.usageReport = (title, extra = []) => {
      const rows = Object.entries(S.usage).sort((a, b) => b[1].minutes - a[1].minutes);
      return [title + ' usage report ' + today(), ...rows.map(([w, u]) => `${w}: ${u.visits} visits, ${Math.round(u.minutes)} min, ${u.first}→${u.last}, screen ${u.width}px, time by view: ${Object.entries(u.views).map(([k, v]) => k + ' ' + Math.round(v) + 'm').join(', ') || 'none'}`), ...extra].join('\n');
    };

    // ---- sync link (no server): encodes state into a URL fragment, merges on open ----
    const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unb64 = s => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
    PWA.syncLink = () => location.origin + location.pathname + '#/sync/' + b64(PWA.syncFilter ? PWA.syncFilter(S) : S);  // set PWA.syncFilter to strip secrets/device-only fields
    function mergeUsage(o) {
      for (const [w, u] of Object.entries(o.usage || {})) { if (w === PWA.where) continue; const m = S.usage[w]; if (!m || (u.last || '') >= (m.last || '')) S.usage[w] = u; }
    }

    // ---- install button (Chrome/Edge/Android); iOS uses Share → Add to Home Screen ----
    let deferred = null;
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; const b = $('#install'); if (b) b.hidden = false; });
    addEventListener('appinstalled', () => { const b = $('#install'); if (b) b.hidden = true; });
    const ib = $('#install'); if (ib) ib.onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; ib.hidden = true; };
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

    // ---- router ----
    const app = $('#app');
    function route() {
      const [, name, arg] = (location.hash.slice(1) || '/').split('/');
      if (name === 'sync' && arg) {
        try { const o = unb64(arg); mergeUsage(o); (mergeApp || (() => {}))(o, S); PWA.save(); app.innerHTML = `<h1>Synced</h1><p>Data from the other device is merged here (${PWA.esc(PWA.where)}).</p><a class="btn" href="#/">Continue</a>`; }
        catch { app.innerHTML = `<h1>That link didn't work</h1><p class="muted">Copy a fresh sync link on the other device.</p><a class="btn alt" href="#/">Back</a>`; }
        history.replaceState(null, '', location.pathname + '#/'); return;
      }
      document.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x.dataset.t === (name || 'home')));
      (routes[name] || home)(arg); if (sidebar) sidebar(name, arg); scrollTo(0, 0);
    }
    PWA.route = route; PWA.go = h => { location.hash = h; };
    addEventListener('hashchange', route); route();
  };
})();
