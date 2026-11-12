// Family Chores: tiny Supabase client using plain fetch (no SDK, no third-party code).
// Config (project URL + publishable key) comes from config.js, which is written at deploy time
// from GitHub secrets and is never committed. Sessions: localStorage, or sessionStorage on shared devices.
(function () {
  const CFG = window.FC_CONFIG || {};
  const API = window.API = {};
  const SKEY = 'fc-session';
  const store = () => (localStorage.getItem('fc-shared') === '1' ? sessionStorage : localStorage);
  let session = JSON.parse(store().getItem(SKEY) || 'null');
  API.ready = !!(CFG.url && CFG.key);
  API.session = () => session;
  API.userId = () => session?.user?.id || null;
  const saveSession = s => {
    session = s ? { ...s, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) } : null;
    localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY);
    if (session) store().setItem(SKEY, JSON.stringify(session));
  };
  API.setShared = shared => { if (shared) localStorage.setItem('fc-shared', '1'); else localStorage.removeItem('fc-shared'); if (session) saveSession(session); };
  API.isShared = () => localStorage.getItem('fc-shared') === '1';

  // A stable random id for this browser (device restriction). Not secret; a parent approves it.
  API.deviceId = () => { let d = localStorage.getItem('fc-device'); if (!d) { d = 'dev-' + crypto.randomUUID().replace(/-/g, ''); localStorage.setItem('fc-device', d); } return d; };

  async function call(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
    if (auth) await refreshIfNeeded();
    const h = { apikey: CFG.key, ...headers };
    if (auth && session?.access_token) h.Authorization = 'Bearer ' + session.access_token;
    if (body !== undefined && !(body instanceof Blob)) h['Content-Type'] = h['Content-Type'] || 'application/json';
    const r = await fetch(CFG.url + path, { method, headers: h, body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body) });
    if (raw) return r;
    const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) { const msg = (data && (data.message || data.msg || data.error_description || data.error)) || ('Error ' + r.status); const e = new Error(msg); e.status = r.status; throw e; }
    return data;
  }
  API.call = call;

  async function refreshIfNeeded() {
    if (!session?.refresh_token) return;
    if (session.expires_at - 60 > Date.now() / 1000) return;
    try { saveSession(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false })); }
    catch { saveSession(null); }
  }

  // ---- parents: email sign-in link (PKCE) ----
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  API.sendParentLink = async email => {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    localStorage.setItem('fc-pkce', verifier);
    const redirect = location.origin + location.pathname;
    await call('/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), { method: 'POST', auth: false,
      body: { email, create_user: true, code_challenge: challenge, code_challenge_method: 's256' } });
  };
  API.finishParentLink = async () => {   // called on load when the URL has ?code=
    const code = new URLSearchParams(location.search).get('code'); if (!code) return false;
    const verifier = localStorage.getItem('fc-pkce');
    history.replaceState(null, '', location.pathname + location.hash);
    if (!verifier) throw new Error('Open the sign-in link on the same device and browser you requested it from.');
    const s = await call('/auth/v1/token?grant_type=pkce', { method: 'POST', auth: false, body: { auth_code: code, code_verifier: verifier } });
    localStorage.removeItem('fc-pkce'); saveSession(s); return true;
  };

  // ---- kids: username + password via the kid-login function ----
  API.kidLogin = async (username, password) => {
    const r = await fetch(CFG.url + '/functions/v1/kid-login', { method: 'POST', headers: { apikey: CFG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, device_id: API.deviceId() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token_hash) throw new Error(d.error || 'Sign-in failed');
    let s;
    try { s = await call('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'magiclink', token_hash: d.token_hash } }); }
    catch { s = await call('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'email', token_hash: d.token_hash } }); }
    saveSession(s);
  };

  API.signOut = async () => { try { await call('/auth/v1/logout', { method: 'POST' }); } catch {} saveSession(null); };

  // ---- data ----
  API.select = (table, query = 'select=*') => call(`/rest/v1/${table}?${query}`);
  API.insert = (table, row) => call(`/rest/v1/${table}`, { method: 'POST', body: row, headers: { Prefer: 'return=representation' } });
  API.update = (table, match, patch) => call(`/rest/v1/${table}?${match}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } });
  API.remove = (table, match) => call(`/rest/v1/${table}?${match}`, { method: 'DELETE' });
  API.rpc = (fn, args = {}) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });

  // ---- private photos ----
  API.upload = (path, blob) => call(`/storage/v1/object/proofs/${path}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type, 'x-upsert': 'true' } });
  API.photoUrl = async path => { const d = await call(`/storage/v1/object/sign/proofs/${path}`, { method: 'POST', body: { expiresIn: 300 } }); return CFG.url + '/storage/v1' + d.signedURL; };
})();
