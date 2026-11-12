// Family Chores (connected). Slice 1: sign-in, family setup, people + kid logins, scoreboard, money, settings.
const $ = s => document.querySelector(s), E = s => PWA.esc(s);
const AGES = [['little', 'Little (4–7)'], ['kid', 'Kid (8–12)'], ['teen', 'Teen (13–17)'], ['adult', 'Adult']];
const ageLabel = a => (AGES.find(x => x[0] === a) || [, a])[1];
const ctx = { me: null, family: null, members: [], settings: null, loaded: false };
const money = c => new Intl.NumberFormat(undefined, { style: 'currency', currency: ctx.settings?.currency || 'USD' }).format((c || 0) / 100);
const isParent = () => ctx.me?.role === 'parent';
const app = () => $('#app');
const busy = (btn, on) => { if (btn) { btn.disabled = on; btn.dataset.t = btn.dataset.t || btn.textContent; btn.textContent = on ? 'Please wait…' : btn.dataset.t; } };
const fail = (where, e) => { const el = $(where); if (el) { el.className = 'err'; el.textContent = e.message || String(e); } };

// ---------- loading who I am ----------
async function loadContext() {
  const uid = API.userId(); if (!uid) return false;
  const mine = await API.select('members', `select=*&user_id=eq.${uid}`);
  ctx.me = mine[0] || null;
  if (!ctx.me) return true;
  const [fam, members, settings] = await Promise.all([
    API.select('families', `select=*&id=eq.${ctx.me.family_id}`),
    API.select('members', `select=id,display_name,emoji,role,age_group,active,user_id,username,device_restricted&family_id=eq.${ctx.me.family_id}&order=role.desc,display_name`),
    API.select('settings', `select=*&family_id=eq.${ctx.me.family_id}`)]);
  ctx.family = fam[0]; ctx.members = members; ctx.settings = settings[0];
  return true;
}

// ---------- signed-out screens ----------
function signIn(tab = 'kid', msg = '') {
  app().innerHTML = `<div class="auth"><h1>Sign in</h1>
<nav class="seg" aria-label="Who is signing in"><a href="#/signin/kid" class="${tab === 'kid' ? 'on' : ''}" ${tab === 'kid' ? 'aria-current="page"' : ''}>Kids</a><a href="#/signin/parent" class="${tab === 'parent' ? 'on' : ''}" ${tab === 'parent' ? 'aria-current="page"' : ''}>Parents</a></nav>
${tab === 'kid' ? `<form id="kf" class="form card">
<label>Username <input name="u" autocomplete="username" autocapitalize="none" required maxlength="20"></label>
<label>Password <input name="p" type="password" autocomplete="current-password" required maxlength="40"></label>
<label class="chk"><input type="checkbox" name="shared" ${API.isShared() ? 'checked' : ''}> This isn't my device (forget me when I close it)</label>
<button class="btn">Sign in</button><p id="msg" role="status">${E(msg)}</p></form>`
  : `<form id="pf" class="form card"><label>Your email <input name="e" type="email" autocomplete="email" required></label>
<button class="btn">Email me a sign-in link</button><p class="muted">Open the link on this same device and browser.</p><p id="msg" role="status">${E(msg)}</p></form>`}
</div>`;
  const kf = $('#kf'); if (kf) kf.onsubmit = async e => { e.preventDefault(); const d = new FormData(kf), b = kf.querySelector('button');
    busy(b, true); try { API.setShared(!!d.get('shared')); await API.kidLogin(String(d.get('u')).trim().toLowerCase(), String(d.get('p'))); await start(); } catch (err) { fail('#msg', err); } busy(b, false); };
  const pf = $('#pf'); if (pf) pf.onsubmit = async e => { e.preventDefault(); const b = pf.querySelector('button'); busy(b, true);
    try { API.setShared(false); await API.sendParentLink(String(new FormData(pf).get('e')).trim()); $('#msg').className = 'ok'; $('#msg').textContent = 'Check your email for the sign-in link.'; } catch (err) { fail('#msg', err); } busy(b, false); };
}

function noMember() {
  app().innerHTML = `<div class="auth"><h1>Welcome</h1>
<div class="card"><h2>Join your family</h2><p class="muted">A parent can give you an invite code from Setup → People.</p>
<form id="jf" class="form"><label>Invite code <input name="c" autocapitalize="characters" maxlength="12" required></label><button class="btn">Join</button><p id="jmsg" role="status"></p></form></div>
<details class="card"><summary><h2>First time: create the family</h2></summary>
<form id="cf" class="form"><label>Family name <input name="f" maxlength="60" required></label>
<label>Your first name <input name="n" maxlength="24" required></label><label>Emoji <input name="m" maxlength="4" value="🧑"></label>
<button class="btn">Create family</button><p id="cmsg" role="status"></p></form><p class="muted">Only works once. Everyone else joins with a code.</p></details>
<p><button class="btn alt" id="so">Sign out</button></p></div>`;
  $('#jf').onsubmit = async e => { e.preventDefault(); try { await API.rpc('redeem_pairing', { code: new FormData(e.target).get('c') }); await start(); } catch (err) { fail('#jmsg', err); } };
  $('#cf').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
    try { await API.rpc('create_family', { family_name: d.get('f'), my_name: d.get('n'), my_emoji: d.get('m') || '🧑' }); await start(); } catch (err) { fail('#cmsg', err); } };
  $('#so').onclick = async () => { await API.signOut(); start(); };
}

// ---------- shared frame ----------
function frame(html) {
  app().innerHTML = `<p class="who muted">${E(ctx.me.emoji)} ${E(ctx.me.display_name)} · ${E(ctx.family?.name || '')} · <a href="#" id="so">Sign out</a></p>${html}`;
  $('#so').onclick = async e => { e.preventDefault(); await API.signOut(); location.hash = '#/'; start(); };
}

// ---------- views ----------
const V = {};
V.home = async () => {
  let bal = null; try { bal = await API.rpc('balance', { member: ctx.me.id }); } catch {}
  let top = []; try { top = await API.rpc('leaderboard', { period: 'week' }); } catch {}
  const pole = top.find(r => r.rank === 1 && r.points > 0);
  frame(`<h1>Hi ${E(ctx.me.display_name)}</h1>
<p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${bal !== null ? ` · balance <b>${money(bal)}</b>` : ''}</p>
${pole ? `<a class="card notice" href="#/board">🏆 Pole position this week: ${E(pole.emoji)} ${E(pole.display_name)} · ${pole.points} points</a>` : ''}
<div class="card"><h2>Your chores</h2><p class="muted">${isParent() ? 'Add jobs, tasks and the rubric in Setup → Jobs (coming next). Then each person sees their chores here.' : 'Your chores will show here once a parent adds the jobs.'}</p></div>
${isParent() && ctx.members.some(m => m.role === 'child' && !m.username) ? `<a class="card notice" href="#/setup">Set up logins for the kids in Setup → People</a>` : ''}`);
};

V.board = async (period = 'week') => {
  const rows = await API.rpc('leaderboard', { period });
  const by = ctx.settings?.board_rank_by || 'points';
  frame(`<h1>Scoreboard</h1><nav class="seg" aria-label="Period">${[['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([k, l]) =>
    `<a href="#/board/${k}" class="${period === k ? 'on' : ''}" ${period === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
<p class="muted">Ranked by ${by === 'points' ? 'points (the 1–5 scores of every approved task)' : by === 'jobs' ? 'jobs completed' : 'money earned'}. Only good news here.</p>
<ul class="list">${rows.map(r => `<li class="row rankrow ${r.rank === 1 && (r.points || r.jobs_done) ? 'pole' : ''}"><span class="pos">${r.rank === 1 && (r.points || r.jobs_done) ? '🏆' : r.rank}</span>
<span class="emo" aria-hidden="true">${E(r.emoji)}</span><span class="grow"><b>${E(r.display_name)}</b><br><span class="muted">${r.jobs_done} jobs · ${r.tasks_done} tasks · ${money(r.earned_cents)} earned</span></span><b>${r.points} pts</b></li>`).join('') || '<li class="muted">Nobody yet.</li>'}</ul>`);
};

V.family = async () => {
  frame(`<h1>${E(ctx.family.name)}</h1><ul class="list">${ctx.members.filter(m => m.active).map(m => `<li class="row"><span class="emo" aria-hidden="true">${E(m.emoji)}</span><span class="grow"><b>${E(m.display_name)}</b><br><span class="muted">${m.role} · ${ageLabel(m.age_group)}</span></span></li>`).join('')}</ul>`);
};

V.money = async () => {
  const [bal, scores, pens, pays] = await Promise.all([API.rpc('balance', { member: ctx.me.id }),
    API.select('scores', `select=pay_cents,job_rating,scored_at,feedback&member_id=eq.${ctx.me.id}&order=scored_at.desc&limit=20`),
    API.select('penalties', `select=amount_cents,reason,created_at&member_id=eq.${ctx.me.id}&order=created_at.desc&limit=20`),
    API.select('payouts', `select=id,amount_cents,method,status,paid_at,note&member_id=eq.${ctx.me.id}&order=paid_at.desc&limit=20`)]);
  frame(`<h1>Money</h1><div class="card"><p>Balance</p><p class="code">${money(bal)}</p><p class="muted">Earned from approved jobs, minus penalties and payouts.</p></div>
<h2>Payouts</h2><ul class="list">${pays.map(p => `<li class="row"><span class="grow">${money(p.amount_cents)} · ${E(p.method)}<br><span class="muted">${new Date(p.paid_at).toLocaleDateString()}${p.note ? ' · ' + E(p.note) : ''}</span></span>
${p.status === 'sent' ? `<button class="mini" data-recv="${p.id}">I got it</button>` : '<span class="tag ok">Received</span>'}</li>`).join('') || '<li class="muted">None yet.</li>'}</ul>
<h2>Earned</h2><ul class="list">${scores.map(s => `<li class="row"><span class="grow">${money(s.pay_cents)} · rating ${Number(s.job_rating).toFixed(1)}<br><span class="muted">${new Date(s.scored_at).toLocaleDateString()}${s.feedback ? ' · ' + E(s.feedback) : ''}</span></span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>
<h2>Penalties</h2><ul class="list">${pens.map(p => `<li class="row"><span class="grow">−${money(p.amount_cents)}<br><span class="muted">${E(p.reason)}</span></span></li>`).join('') || '<li class="muted">None. Nice!</li>'}</ul>`);
  document.querySelectorAll('[data-recv]').forEach(b => b.onclick = async () => { await API.rpc('confirm_received', { payout: b.dataset.recv }); V.money(); });
};

V.setup = async () => {
  if (!isParent()) {
    frame(`<h1>Setup</h1><div class="card"><h2>This device</h2><label class="chk"><input type="checkbox" id="sh" ${API.isShared() ? 'checked' : ''}> Shared device: forget my sign-in when closed and sign me out after ${ctx.settings?.kid_idle_minutes || 30} idle minutes</label></div><p><a href="#/about">About &amp; privacy</a></p>`);
    $('#sh').onchange = e => API.setShared(e.target.checked); return;
  }
  const st = ctx.settings, o = (v, cur, l) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`;
  frame(`<h1>Setup</h1>
<details class="card" open><summary><h2>People</h2></summary><ul class="list">${ctx.members.map(m => `<li class="row"><span class="emo" aria-hidden="true">${E(m.emoji)}</span><span class="grow"><b>${E(m.display_name)}</b><br>
<span class="muted">${m.role} · ${ageLabel(m.age_group)}${m.role === 'child' ? (m.username ? ` · login: ${E(m.username)}` : ' · <b>no login yet</b>') : (m.user_id ? ' · signed up' : ' · not joined yet')}${m.device_restricted ? ' · device-restricted' : ''}</span></span>
<span class="acts"><button class="mini alt" data-edit="${m.id}">Manage</button></span></li>`).join('')}</ul>
<button class="btn alt" data-edit="new">Add person</button><div id="pbox"></div></details>
<details class="card"><summary><h2>Scoreboard &amp; rules</h2></summary><form id="sf" class="form">
<label>Rank the scoreboard by <select name="rb">${o('points', st.board_rank_by, 'Points (quality + quantity)')}${o('jobs', st.board_rank_by, 'Jobs completed')}${o('money', st.board_rank_by, 'Money earned')}</select></label>
<label class="chk"><input type="checkbox" name="bp" ${st.board_parents ? 'checked' : ''}> Show parents on the scoreboard</label>
<label class="chk"><input type="checkbox" name="as" ${st.approve_swaps ? 'checked' : ''}> A parent approves swaps</label>
<label>Week starts <select name="ws">${o(0, st.week_start, 'Sunday')}${o(1, st.week_start, 'Monday')}</select></label>
<label>Kids on shared devices: sign out after (minutes idle) <input name="idle" type="number" min="5" max="240" value="${st.kid_idle_minutes}"></label>
<label>Currency <select name="cur">${['USD', 'CAD', 'GBP', 'EUR', 'AUD'].map(c => o(c, st.currency, c)).join('')}</select></label>
<button class="btn">Save</button> <span id="smsg" role="status"></span></form></details>
<p><a href="#/about">About, privacy &amp; usage</a></p>`);
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => personBox(b.dataset.edit));
  $('#sf').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
    try { await API.update('settings', `family_id=eq.${ctx.family.id}`, { board_rank_by: d.get('rb'), board_parents: !!d.get('bp'), approve_swaps: !!d.get('as'),
      week_start: +d.get('ws'), kid_idle_minutes: Math.min(240, Math.max(5, +d.get('idle') || 30)), currency: d.get('cur') });
      await loadContext(); $('#smsg').className = 'ok'; $('#smsg').textContent = 'Saved.'; } catch (err) { fail('#smsg', err); } };
};

function personBox(id) {
  const m = id === 'new' ? { display_name: '', emoji: '🙂', role: 'child', age_group: 'kid' } : ctx.members.find(x => x.id === id);
  const o = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  $('#pbox').innerHTML = `<div class="card"><h3>${id === 'new' ? 'Add person' : E(m.display_name)}</h3>
<form id="mf" class="form"><label>First name or nickname <input name="n" maxlength="24" required value="${E(m.display_name)}"></label>
<label>Emoji <input name="e" maxlength="4" value="${E(m.emoji)}"></label>
<label>Role <select name="r" ${id !== 'new' ? 'disabled' : ''}>${o('child', m.role, 'Child')}${o('parent', m.role, 'Parent')}</select></label>
<label>Age group <select name="a">${AGES.map(([v, l]) => o(v, m.age_group, l)).join('')}</select></label>
<button class="btn">Save</button> <span id="mmsg" role="status"></span></form>
${id !== 'new' && m.role === 'child' ? `<h3>Login</h3><form id="lf" class="form"><label>Username (a–z, 0–9, _) <input name="u" pattern="[a-z0-9_]{3,20}" maxlength="20" required value="${E(m.username || '')}" autocapitalize="none"></label>
<label>New password (6–40 characters) <input name="p" type="password" minlength="6" maxlength="40" autocomplete="new-password" required></label>
<button class="btn">Save login</button> <button type="button" class="btn alt" id="unl">Unlock after wrong tries</button> <span id="lmsg" role="status"></span></form>
<h3>Devices (optional)</h3><label class="chk"><input type="checkbox" id="dr" ${m.device_restricted ? 'checked' : ''}> Only allow approved devices</label>
<p><button class="btn alt" id="thisdev">Approve this device for ${E(m.display_name)}</button> <span id="dmsg" role="status"></span></p>` : ''}
${id !== 'new' && m.role === 'parent' && !m.user_id ? `<h3>Invite</h3><p class="muted">${E(m.display_name)} signs in with their email on their own device, then enters this code (valid 30 minutes, works once).</p>
<button class="btn alt" id="inv">Make invite code</button><p id="code" class="code" aria-live="polite"></p>` : ''}</div>`;
  $('#mf').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
    const row = { display_name: String(d.get('n')).trim(), emoji: String(d.get('e') || '🙂'), age_group: d.get('a') };
    try { if (id === 'new') await API.insert('members', { ...row, family_id: ctx.family.id, role: d.get('r') }); else await API.update('members', `id=eq.${id}`, row);
      await loadContext(); V.setup(); } catch (err) { fail('#mmsg', err); } };
  const lf = $('#lf'); if (lf) lf.onsubmit = async e => { e.preventDefault(); const d = new FormData(lf);
    try { await API.rpc('set_kid_login', { member: id, uname: String(d.get('u')).trim().toLowerCase(), pass: String(d.get('p')) }); lf.reset(); await loadContext();
      $('#lmsg').className = 'ok'; $('#lmsg').textContent = 'Login saved. Share it with them privately.'; } catch (err) { fail('#lmsg', err); } };
  const unl = $('#unl'); if (unl) unl.onclick = async () => { try { await API.rpc('unlock_kid', { member: id }); $('#lmsg').className = 'ok'; $('#lmsg').textContent = 'Unlocked.'; } catch (err) { fail('#lmsg', err); } };
  const dr = $('#dr'); if (dr) dr.onchange = async () => { try { await API.update('members', `id=eq.${id}`, { device_restricted: dr.checked }); await loadContext(); } catch (err) { fail('#dmsg', err); } };
  const td = $('#thisdev'); if (td) td.onclick = async () => { try { await API.insert('member_devices', { member_id: id, family_id: ctx.family.id, device_id: API.deviceId(), label: (navigator.userAgentData?.platform || 'This device').slice(0, 30) });
    $('#dmsg').className = 'ok'; $('#dmsg').textContent = 'This device is approved.'; } catch (err) { fail('#dmsg', err.status === 409 ? new Error('Already approved.') : err); } };
  const inv = $('#inv'); if (inv) inv.onclick = async () => { try { $('#code').textContent = await API.rpc('create_pairing', { member: id }); } catch (err) { fail('#code', err); } };
  $('#pbox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

V.about = async () => {
  const rows = Object.entries(PWA.state.usage).sort((a, b) => b[1].minutes - a[1].minutes);
  frame(`<h1>About &amp; privacy</h1>
<div class="card"><h2>Privacy</h2><p>Your family's data lives in a private database that only signed-in family members can reach. Kids can't see each other's money details, scores or photos. Only first names, emoji and age groups are stored about people; kids have no email. Proof photos are private (you and parents only). No ads, no tracking, no cookies.</p></div>
<div class="card"><h2>Use it as an app</h2><p class="muted">${PWA.mode === 'app' ? 'You are in the app.' : 'Install app (Chrome/Edge, laptop or Android) or Safari → Share → Add to Home Screen.'}</p></div>
<div class="card"><h2>Where it's used</h2>${rows.map(([w, u]) => `<p><b>${E(w)}${w === PWA.where ? ' (here)' : ''}</b>: ${u.visits} visit${u.visits === 1 ? '' : 's'} · ${Math.round(u.minutes)} min</p>`).join('')}
<button class="btn alt" id="rep">Copy usage report</button></div>`);
  $('#rep').onclick = () => navigator.clipboard.writeText(PWA.usageReport('Family Chores'));
};

// ---------- idle sign-out for kids on shared devices ----------
let lastActive = Date.now();
['pointerdown', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(async () => {
  if (ctx.me?.role === 'child' && API.isShared() && Date.now() - lastActive > (ctx.settings?.kid_idle_minutes || 30) * 60000) { await API.signOut(); ctx.me = null; signIn('kid', 'Signed out after being idle.'); }
}, 30000);

// ---------- start ----------
const guard = fn => async (...a) => {
  if (!ctx.loaded) { app().innerHTML = '<p class="muted">Loading…</p>'; return; }
  if (!API.userId()) return signIn((a[0] === 'parent') ? 'parent' : 'kid');
  if (!ctx.me) return noMember();
  try { await fn(...a); } catch (err) { if (err.status === 401) { await API.signOut(); return signIn(); } app().innerHTML = `<p class="err">${E(err.message)}</p><p><a class="btn alt" href="#/">Home</a></p>`; }
};
async function start() {
  if (!API.ready) { app().innerHTML = '<h1>Setup needed</h1><p>This copy of the app has no database settings yet.</p>'; return; }
  try { await API.finishParentLink(); } catch (err) { signIn('parent', err.message); return; }
  try { await loadContext(); } catch (err) { if (err.status === 401) await API.signOut(); }
  ctx.loaded = true; PWA.route();
}
PWA.init({
  key: 'family-chores-web-v1', defaults: {},
  home: guard(V.home),
  routes: { board: guard(V.board), family: guard(V.family), money: guard(V.money), setup: guard(V.setup), about: guard(V.about),
    signin: tab => (API.userId() ? PWA.go('#/') : signIn(tab || 'kid')) }
});
start();
