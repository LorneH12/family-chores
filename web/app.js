// Family Chores (connected). Slice 1: sign-in, family setup, people + kid logins, scoreboard, money, settings.
const $ = s => document.querySelector(s), E = s => PWA.esc(s);
const AGES = [['little', 'Little (4–7)'], ['kid', 'Kid (8–12)'], ['teen', 'Teen (13–17)'], ['adult', 'Adult']];
const ageLabel = a => (AGES.find(x => x[0] === a) || [, a])[1];
const ctx = { me: null, family: null, members: [], settings: null, loaded: false };
const money = c => new Intl.NumberFormat(undefined, { style: 'currency', currency: ctx.settings?.currency || 'USD' }).format((c || 0) / 100);
const isParent = () => ctx.me?.role === 'parent';
const isAdmin = () => isParent() && !!ctx.me?.is_admin;
const weekStart = () => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - ((d.getDay() - (ctx.settings?.week_start || 0) + 7) % 7)); return d.toISOString().slice(0, 10); };
const avatarOf = id => { const a = ctx.avatars?.[id]; const m = ctx.members.find(x => x.id === id) || {}; return a ? { ...a.config, personality: a.personality, name: a.nickname || m.display_name } : null; };
const ROOM_ART = n => { n = (n || '').toLowerCase(); return n.includes('kitchen') ? 'kitchen' : n.includes('living') ? 'living-room' : n.includes('bath') ? 'main-bathroom' : n.includes('hall') ? 'hallway-and-entry' : n.includes('laundry') ? 'laundry' : n.includes('dining') ? 'dining-room' : n.includes('yard') || n.includes('outside') ? 'yard-and-outside' : n.includes('garage') ? 'garage' : n.includes('bedroom') ? 'bedroom' : n.includes('ready') ? 'getting-ready' : 'living-room'; };
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
    API.select('members', `select=id,display_name,emoji,role,age_group,active,user_id,username,device_restricted,is_admin,status,is_guest,guest_label,access_until&family_id=eq.${ctx.me.family_id}&order=role.desc,display_name`),
    API.select('settings', `select=*&family_id=eq.${ctx.me.family_id}`)]);
  ctx.family = fam[0]; ctx.members = members; ctx.settings = settings[0];
  try { ctx.avatars = Object.fromEntries((await API.select('avatars', 'select=*')).map(a => [a.member_id, a])); } catch { ctx.avatars = {}; }
  return true;
}

// ---------- signed-out screens ----------
function signIn(tab = 'kid', msg = '') {
  app().innerHTML = `<div class="auth"><h1>Sign in</h1>
<nav class="seg" aria-label="Who is signing in"><a href="#/signin/kid" class="${tab === 'kid' ? 'on' : ''}" ${tab === 'kid' ? 'aria-current="page"' : ''}>Children</a><a href="#/signin/parent" class="${tab === 'parent' ? 'on' : ''}" ${tab === 'parent' ? 'aria-current="page"' : ''}>Parents</a></nav>
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

async function noMember() {
  let st = null; try { st = (await API.rpc('my_status'))[0] || null; } catch {}
  if (st && st.status === 'pending') {
    app().innerHTML = `<div class="auth"><h1>Almost there</h1><div class="card"><p>Your request to join${st.label ? ' as <b>' + E(st.label) + '</b>' : ''} is waiting for a parent to approve it.</p><p class="muted">Check back soon. This page updates when you open it again.</p></div><p><button class="btn alt" id="so">Sign out</button></p></div>`;
    $('#so').onclick = async () => { await API.signOut(); start(); }; return;
  }
  if (st && (st.status === 'declined' || st.status === 'revoked' || (st.access_until && new Date(st.access_until) <= new Date()) || (st.access_from && new Date(st.access_from) > new Date()))) {
    const soon = st.access_from && new Date(st.access_from) > new Date();
    app().innerHTML = `<div class="auth"><h1>${soon ? 'Not open yet' : 'Access ended'}</h1><div class="card"><p>${soon ? 'Your access starts ' + new Date(st.access_from).toLocaleString() + '.' : 'Your access to this family has ended. Ask a parent if you need it again.'}</p></div><p><button class="btn alt" id="so">Sign out</button></p></div>`;
    $('#so').onclick = async () => { await API.signOut(); start(); }; return;
  }
  app().innerHTML = `<div class="auth"><h1>Welcome</h1>
<div class="card"><h2>Join with an invite</h2><p class="muted">A parent gives you an invite code. After you join, a parent approves you.</p>
<form id="jf" class="form"><label>Invite code <input name="c" autocapitalize="characters" maxlength="12" required></label>
<label>Your first name <input name="n" maxlength="24" required></label><label>Emoji <input name="m" maxlength="4" value="🙂"></label>
<button class="btn">Join</button><p id="jmsg" role="status"></p></form></div>
<details class="card"><summary><h2>First time: create the family</h2></summary>
<form id="cf" class="form"><label>Family name <input name="f" maxlength="60" required></label>
<label>Your first name <input name="n" maxlength="24" required></label><label>Emoji <input name="m" maxlength="4" value="🧑"></label>
<button class="btn">Create family</button><p id="cmsg" role="status"></p></form><p class="muted">Only works once. You become the admin. Everyone else joins with an invite.</p></details>
<p><button class="btn alt" id="so">Sign out</button></p></div>`;
  $('#jf').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
    try { await API.rpc('request_join', { code: d.get('c'), my_name: d.get('n'), my_emoji: d.get('m') || '🙂' }); await start(); }
    catch (err) { try { await API.rpc('redeem_pairing', { code: d.get('c') }); await start(); } catch { fail('#jmsg', err); } } };
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
${ctx.avatars[ctx.me.id] ? '' : '<a class="card notice" href="#/avatar">🎨 Make your avatar: it does your chores in the rooms</a>'}
<div class="card"><h2>Your chores</h2><p class="muted">${isParent() ? 'Add jobs, tasks and the rubric in Setup → Jobs (coming next). Then each person sees their chores here.' : 'Your chores will show here once a parent adds the jobs.'}</p></div>
${isParent() && ctx.members.some(m => m.role === 'child' && !m.username) ? `<a class="card notice" href="#/setup">Set up logins for the children in Setup → People</a>` : ''}`);
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
<label>Children on shared devices: sign out after (minutes idle) <input name="idle" type="number" min="5" max="240" value="${st.kid_idle_minutes}"></label>
<label>Currency <select name="cur">${['USD', 'CAD', 'GBP', 'EUR', 'AUD'].map(c => o(c, st.currency, c)).join('')}</select></label>
<button class="btn">Save</button> <span id="smsg" role="status"></span></form></details>
<details class="card" id="invites"><summary><h2>Invites &amp; requests</h2></summary><div id="invbox"><p class="muted">Loading…</p></div></details>
<details class="card"><summary><h2>Money dials</h2></summary><form id="df" class="form">
<label>Pay: % of listed prices <input name="pay" type="number" min="0" max="300" value="${st.pay_percent ?? 100}"></label>
<label>Whole-room bonus % <input name="bon" type="number" min="0" max="300" value="${st.bonus_percent ?? 100}"></label>
<label>Penalty % <input name="pen" type="number" min="0" max="300" value="${st.penalty_percent ?? 100}"></label>
<label>Round pay to <select name="rnd">${[1, 5, 10, 25, 50, 100].map(c => `<option value="${c}" ${c === (st.round_to_cents ?? 5) ? 'selected' : ''}>${c === 1 ? 'exact cents' : c + '¢'}</option>`).join('')}</select></label>
<button class="btn">Save dials</button> <span id="dmsg2" role="status"></span></form>
<p class="muted">Each chore keeps its own price, minimum and maximum; the dials scale them all. Every price change is kept in the price history.</p></details>
${isAdmin() ? `<details class="card"><summary><h2>Admin</h2></summary>
<p id="starter"></p>
<label class="chk"><input type="checkbox" id="aiv" ${st.ai_voice ? 'checked' : ''}> AI voice for avatars (optional; needs an AI key added in Supabase first)</label>
<p class="muted">Off: avatars use the built-in voice, which still adapts to each person. Limits: ${st.ai_daily_lines ?? 20} lines per person a day, family cap $${((st.ai_monthly_cap_cents ?? 300) / 100).toFixed(2)} a month.</p><p id="aimsg" role="status"></p></details>` : ''}
<p><a href="#/avatar">My avatar</a> · <a href="#/family">Family</a> · <a href="#/about">About, privacy &amp; usage</a></p>`);
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => personBox(b.dataset.edit));
  invites();
  $('#df').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
    try { await API.update('settings', `family_id=eq.${ctx.family.id}`, { pay_percent: +d.get('pay'), bonus_percent: +d.get('bon'), penalty_percent: +d.get('pen'), round_to_cents: +d.get('rnd') });
      await loadContext(); $('#dmsg2').className = 'ok'; $('#dmsg2').textContent = 'Saved.'; } catch (err) { fail('#dmsg2', err); } };
  if (isAdmin()) {
    const sp = $('#starter'); const n = (await API.select('rooms', 'select=id&limit=1')).length;
    sp.innerHTML = n ? '<span class="muted">Starter rooms are loaded. Edit rooms and chores any time.</span>' : '<button class="btn" id="load">Load the starter rooms and chores</button> <span id="lmsg2" role="status"></span>';
    const lb = $('#load'); if (lb) lb.onclick = async () => { busy(lb, true); try { const r = await API.rpc('load_starter_chores'); $('#lmsg2').className = 'ok'; $('#lmsg2').textContent = r; } catch (err) { fail('#lmsg2', err); } busy(lb, false); };
    $('#aiv').onchange = async e => { try { await API.update('settings', `family_id=eq.${ctx.family.id}`, { ai_voice: e.target.checked }); await loadContext();
      $('#aimsg').className = 'ok'; $('#aimsg').textContent = e.target.checked ? 'AI voice is on (until an AI key is added, avatars keep the built-in voice).' : 'AI voice is off.'; } catch (err) { e.target.checked = !e.target.checked; fail('#aimsg', err); } };
  }
  $('#sf').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
    try { await API.update('settings', `family_id=eq.${ctx.family.id}`, { board_rank_by: d.get('rb'), board_parents: !!d.get('bp'), approve_swaps: !!d.get('as'),
      week_start: +d.get('ws'), kid_idle_minutes: Math.min(240, Math.max(5, +d.get('idle') || 30)), currency: d.get('cur') });
      await loadContext(); $('#smsg').className = 'ok'; $('#smsg').textContent = 'Saved.'; } catch (err) { fail('#smsg', err); } };
};

async function invites() {
  const box = $('#invbox'); if (!box) return;
  const pending = ctx.members.filter(m => m.status === 'pending');
  const roles = isAdmin() ? [['caregiver', 'Caregiver (babysitter, helper)'], ['child', 'Visiting child'], ['parent', 'Parent']] : [['caregiver', 'Caregiver (babysitter, helper)'], ['child', 'Visiting child']];
  box.innerHTML = `${pending.length ? `<h3>Waiting for approval</h3><ul class="list">${pending.map(m => `<li class="row"><span class="emo">${E(m.emoji)}</span><span class="grow"><b>${E(m.display_name)}</b><br><span class="muted">${E(m.guest_label || '')} · ${m.role}</span></span>
<span class="acts"><button class="mini" data-ok="${m.id}">Approve</button><button class="mini alt" data-no="${m.id}">Decline</button></span></li>`).join('')}</ul>` : '<p class="muted">No one is waiting.</p>'}
<h3>New invite</h3><form id="if" class="form"><label>Who is it for? <input name="label" maxlength="40" required placeholder="e.g. Babysitter Saturday"></label>
<label>Role <select name="role">${roles.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
<label>How long <select name="dur"><option value="one_off">One time</option><option value="temporary">From – to dates</option><option value="permanent">Permanent</option></select></label>
<label>Starts <input name="from" type="datetime-local"></label><label>Ends (not needed for permanent) <input name="until" type="datetime-local"></label>
<button class="btn">Make invite</button><p id="imsg" role="status"></p></form>`;
  box.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { await API.rpc('decide_member', { member: b.dataset.ok, approve: true }); await loadContext(); invites(); });
  box.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => { await API.rpc('decide_member', { member: b.dataset.no, approve: false }); await loadContext(); invites(); });
  $('#if').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target), dur = d.get('dur');
    const iso = v => v ? new Date(v).toISOString() : null;
    try { const code = await API.rpc('create_invite', { role: d.get('role'), label: String(d.get('label')).trim(), duration: dur, access_from: iso(d.get('from')), access_until: dur === 'permanent' ? null : iso(d.get('until')) });
      const link = location.origin + location.pathname, text = `You're invited to ${ctx.family.name} on Family Chores. Open ${link}, sign in with your email, choose "Join with an invite" and enter: ${code} (works once, for 3 days).`;
      $('#imsg').innerHTML = `<span class="code">${E(code)}</span><br><button type="button" class="btn alt" id="share">Share invite</button>`;
      $('#share').onclick = async () => { try { if (navigator.share) await navigator.share({ title: 'Family Chores invite', text }); else { await navigator.clipboard.writeText(text); $('#share').textContent = 'Copied: paste it into a text or email'; } } catch {} };
    } catch (err) { fail('#imsg', err); } };
}

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


// ---------- avatar creator ----------
V.avatar = async () => {
  const cur = ctx.avatars[ctx.me.id];
  const cfg = Object.assign({ skin: Avatar.SKIN[3], hair: 'puffs', outfit: 'hoodie', size: ctx.me.role === 'parent' ? 1.08 : 0.95 }, cur?.config || {});
  let personality = cur?.personality || 'cheerful', nickname = cur?.nickname || '';
  const o = (list, v) => list.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
  frame(`<h1>Your avatar</h1><p class="muted">Your avatar does your chores in the rooms and talks to you in its own voice.</p>
<div class="card" style="display:grid;grid-template-columns:120px 1fr;gap:16px;align-items:center"><div id="prev" style="height:150px"></div>
<div class="form" style="margin:0"><label>Nickname <input id="nn" maxlength="24" value="${E(nickname)}" placeholder="${E(ctx.me.display_name)}"></label>
<label>Personality <select id="pp">${o(Voice.personalities.map(p => [p, p[0].toUpperCase() + p.slice(1)]), personality)}</select></label></div></div>
<div class="card form"><div><b style="font-size:14px">Skin</b><div id="sk" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${Avatar.SKIN.map((c, i) => `<button type="button" aria-label="Skin tone ${i + 1}" aria-pressed="${c === cfg.skin}" data-c="${c}" style="width:40px;height:40px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 0 0 ${c === cfg.skin ? 3 : 1}px ${c === cfg.skin ? 'var(--t)' : '#bbb'}"></button>`).join('')}</div></div>
<label>Hair <select id="hr">${o(Avatar.HAIR, cfg.hair)}</select></label><label>Outfit <select id="of">${o(Avatar.OUTFIT, cfg.outfit)}</select></label>
<label>Size <select id="sz">${o(Avatar.SIZE, cfg.size)}</select></label>
<button class="btn" id="save">Save my avatar</button><p id="amsg" role="status"></p></div>`);
  const prev = () => { const b = $('#prev'); b.innerHTML = ''; const sv = Avatar.svg(cfg, 'Your avatar'); sv.style.height = '150px'; b.appendChild(sv);
    $('#amsg').className = 'muted'; $('#amsg').textContent = Voice.say({ personality, outfit: cfg.outfit }, 'greet', { name: nickname || ctx.me.display_name }).text; };
  document.querySelectorAll('#sk button').forEach(b => b.onclick = () => { cfg.skin = b.dataset.c; document.querySelectorAll('#sk button').forEach(x => { const on = x === b; x.setAttribute('aria-pressed', on); x.style.boxShadow = `0 0 0 ${on ? 3 : 1}px ${on ? 'var(--t)' : '#bbb'}`; }); prev(); });
  $('#hr').onchange = e => { cfg.hair = e.target.value; prev(); }; $('#of').onchange = e => { cfg.outfit = e.target.value; prev(); };
  $('#sz').onchange = e => { cfg.size = +e.target.value; prev(); }; $('#pp').onchange = e => { personality = e.target.value; prev(); };
  $('#nn').oninput = e => { nickname = e.target.value; };
  $('#save').onclick = async () => { const row = { member_id: ctx.me.id, family_id: ctx.family.id, config: cfg, personality, nickname: nickname.trim() || null };
    try { await API.call('/rest/v1/avatars?on_conflict=member_id', { method: 'POST', body: row, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
      ctx.avatars[ctx.me.id] = row; $('#amsg').className = 'ok'; $('#amsg').textContent = Voice.say({ personality, outfit: cfg.outfit }, 'praise', { chore: 'your new look', room: 'this avatar' }).text; } catch (err) { fail('#amsg', err); } };
  prev();
};

// ---------- rooms: the 3D wheel ----------
V.rooms = async () => {
  const [rooms, jobs, claims, acts] = await Promise.all([API.select('rooms', 'select=*&active=is.true&order=position'), API.select('jobs', 'select=id,room_id,name,pay_cents,freq,every_n,is_project&active=is.true'),
    API.select('room_claims', `select=room_id,member_id&week_start=eq.${weekStart()}&status=eq.active`), API.select('activity', 'select=member_id,room_id')]);
  if (!rooms.length) { frame(`<h1>Rooms</h1><div class="card"><p>No rooms yet.</p>${isAdmin() ? '<p><a class="btn" href="#/setup">Load the starter rooms in Setup</a></p>' : '<p class="muted">An admin can add rooms in Setup.</p>'}</div>`); return; }
  const pct = (ctx.settings?.pay_percent ?? 100) / 100;
  frame(`<h1>Rooms</h1><p class="muted">Spin to pick a room. Drag the front room to turn it.</p>
<div class="wheel" id="wheel" tabindex="0" aria-label="Rooms wheel: up and down arrows spin, left and right turn the room"><div class="drum" id="drum"></div></div>
<div class="wbtns"><button class="mini alt" id="wup" aria-label="Previous room">▲</button><button class="mini alt" id="wdn" aria-label="Next room">▼</button></div>
<div class="card" id="rpanel" aria-live="polite"></div>`);
  const N = rooms.length, STEP = 360 / N, R = Math.round(110 / Math.tan(Math.PI / Math.max(N, 3)));
  const drum = $('#drum'); drum.style.transform = `translateZ(${-R}px)`;
  let angle = 0, target = 0, frameN = 5, front = -1, live = true;
  const cards = rooms.map((r, i) => { const b = document.createElement('button'); b.className = 'wcard'; b.setAttribute('aria-label', r.name);
    b.innerHTML = `<span class="wart" style="background-image:url(rooms/${ROOM_ART(r.name)}.webp)"></span><span class="wtag">${E(r.emoji)} ${E(r.name)}</span>`;
    b.onclick = () => (i === front ? (location.hash = '#/room/' + r.id) : spin(i)); drum.appendChild(b); return b; });
  const spin = i => { const cur = Math.round(-target / STEP); let d = i - (((cur % N) + N) % N); if (d > N / 2) d -= N; if (d < -N / 2) d += N; target = -(cur + d) * STEP; };
  const panel = r => {
    const chores = jobs.filter(j => j.room_id === r.id && !j.is_project), claim = claims.find(c => c.room_id === r.id), here = acts.filter(a => a.room_id === r.id);
    const who = claim ? ctx.members.find(m => m.id === claim.member_id) : null;
    $('#rpanel').innerHTML = `<h2 style="margin-top:0">${E(r.emoji)} ${E(r.name)}</h2>
<p class="muted">${money(Math.round(r.weekly_value_cents * pct))} a week · ${chores.length} chore${chores.length === 1 ? '' : 's'}${r.whole_bonus_cents ? ` · whole room +${money(Math.round(r.whole_bonus_cents * (ctx.settings?.bonus_percent ?? 100) / 100))}` : ''}</p>
${who ? `<p>🏠 ${E(who.display_name)} has the whole room this week.</p>` : ''}${here.length ? `<p class="muted">Working here now: ${here.map(a => E(ctx.members.find(m => m.id === a.member_id)?.display_name || '')).join(', ')}</p>` : ''}
<p><a class="btn" href="#/room/${r.id}">Open ${E(r.name)}</a></p>`; };
  function loop() { if (!live || !document.getElementById('drum')) return;
    angle += (target - angle) * 0.18; const f = ((Math.round(-angle / STEP) % N) + N) % N;
    cards.forEach((c, i) => { let a = i * STEP + angle; a = ((a + 180) % 360 + 360) % 360 - 180; const vis = Math.max(0, 1 - Math.abs(a) / 95);
      c.style.transform = `rotateX(${-a}deg) translateZ(${R}px) scale(${0.7 + 0.3 * vis})`; c.style.opacity = vis.toFixed(2); c.style.pointerEvents = vis > 0.3 ? 'auto' : 'none'; c.tabIndex = i === f ? 0 : -1;
      c.firstChild.style.backgroundPosition = `${((i === f ? frameN : 5) / 11) * 100}% 0`; c.classList.toggle('front', i === f); });
    if (f !== front) { front = f; panel(rooms[f]); } requestAnimationFrame(loop); }
  let sy = null, sx = null, mode = null, st = 0, sf = 5; const w = $('#wheel');
  w.onpointerdown = e => { sy = e.clientY; sx = e.clientX; mode = null; st = target; sf = frameN; };
  w.onpointermove = e => { if (sy === null) return; const dy = e.clientY - sy, dx = e.clientX - sx; if (!mode && Math.hypot(dx, dy) > 8) mode = Math.abs(dy) > Math.abs(dx) ? 'spin' : 'turn';
    if (mode === 'spin') target = st + dy * 0.35; if (mode === 'turn') frameN = Math.max(0, Math.min(11, Math.round(sf + dx / 18))); };
  w.onpointerup = w.onpointercancel = () => { if (mode === 'spin') target = Math.round(target / STEP) * STEP; sy = null; mode = null; };
  w.onwheel = e => { e.preventDefault(); target -= Math.sign(e.deltaY) * STEP; };
  w.onkeydown = e => { if (e.key === 'ArrowDown') { target -= STEP; e.preventDefault(); } if (e.key === 'ArrowUp') { target += STEP; e.preventDefault(); }
    if (e.key === 'ArrowLeft') frameN = Math.max(0, frameN - 1); if (e.key === 'ArrowRight') frameN = Math.min(11, frameN + 1); if (e.key === 'Enter') location.hash = '#/room/' + rooms[front].id; };
  $('#wup').onclick = () => { target += STEP; }; $('#wdn').onclick = () => { target -= STEP; };
  addEventListener('hashchange', () => { live = false; }, { once: true });
  loop();
};

// ---------- one room: claim it, or pick chores ----------
V.room = async id => {
  const [rooms, jobs, claims, acts] = await Promise.all([API.select('rooms', `select=*&id=eq.${id}`), API.select('jobs', `select=*&room_id=eq.${id}&active=is.true&order=position`),
    API.select('room_claims', `select=*&room_id=eq.${id}&week_start=eq.${weekStart()}`), API.select('activity', `select=*&room_id=eq.${id}`)]);
  const r = rooms[0]; if (!r) { frame('<p>Room not found.</p>'); return; }
  const pays = Object.fromEntries(await Promise.all(jobs.map(async j => [j.id, await API.rpc('effective_pay', { job: j.id }).catch(() => j.pay_cents)])));
  const claim = claims.find(c => c.status === 'active'), mine = acts.find(a => a.member_id === ctx.me.id);
  const me = avatarOf(ctx.me.id) || { outfit: 'hoodie', personality: 'cheerful', name: ctx.me.display_name };
  const often = j => j.freq === 'daily' ? 'every day' : j.freq === 'weekly' ? 'weekly' : `every ${j.every_n} days`;
  const RANK = { little: 0, kid: 1, teen: 2, adult: 3 }, canDo = j => RANK[ctx.me.age_group] >= RANK[j.min_age] && (ctx.me.role === 'child' || j.parents_in || j.is_project);
  const bonus = Math.round(r.whole_bonus_cents * (ctx.settings?.bonus_percent ?? 100) / 100), pen = Math.round(r.whole_penalty_cents * (ctx.settings?.penalty_percent ?? 100) / 100);
  frame(`<p class="muted"><a href="#/rooms">Rooms</a> › ${E(r.name)}</p><h1>${E(r.emoji)} ${E(r.name)}</h1>
<div class="roomart" style="background-image:url(rooms/${ROOM_ART(r.name)}.webp)" role="img" aria-label="${E(r.name)}">${acts.map((a, i) => avatarOf(a.member_id) ? `<span class="here" style="left:${28 + i * 20}%" data-av="${a.member_id}"></span>` : '').join('')}</div>
${ROOM_ART(r.name) === 'kitchen' ? '<p><a href="scene.html">Watch the kitchen scene (preview)</a></p>' : ''}
${r.whole_bonus_cents ? `<div class="card">${claim ? `<p>🏠 <b>${E(ctx.members.find(m => m.id === claim.member_id)?.display_name || '')}</b> has the whole room this week: +${money(claim.bonus_cents)} if every chore is done, −${money(claim.penalty_cents)} if not.</p>`
  : `<p><b>Take the whole room</b> this week: every chore below, plus a <b>${money(bonus)}</b> bonus. Miss one and it's ${money(pen)} off.</p>${ctx.me.role !== 'caregiver' ? '<button class="btn" id="claim">Claim the whole room</button>' : ''}`}<p id="cmsg" role="status"></p></div>` : ''}
<h2>Chores</h2><ul class="list">${jobs.map(j => `<li class="row"><span class="emo" aria-hidden="true">${E(j.emoji)}</span><span class="grow"><b>${E(j.name)}</b><br>
<span class="muted">${money(pays[j.id])} · ${often(j)}${j.is_project ? ' · project' : ''}${j.kind === 'personal' ? ' · private photo' : ''}</span></span>
<span class="acts">${mine && mine.job_id === j.id ? '<span class="tag ok">Doing it</span>' : canDo(j) && ctx.me.role !== 'caregiver' ? `<button class="mini" data-do="${j.id}">I'll do it</button>` : ''}</span></li>`).join('') || '<li class="muted">No chores in this room yet.</li>'}</ul>
<div id="timerbox"></div>`);
  document.querySelectorAll('[data-av]').forEach(sp => { const av = avatarOf(sp.dataset.av); const sv = Avatar.svg(av, av.name); sv.style.height = '100%'; sp.appendChild(sv); });
  const cb = $('#claim'); if (cb) cb.onclick = async () => { try { await API.rpc('claim_room', { room: r.id, week: weekStart() }); $('#cmsg').className = 'ok';
    $('#cmsg').textContent = Voice.say({ personality: me.personality, outfit: me.outfit }, 'start', { chore: 'the whole ' + r.name.toLowerCase() }).text; setTimeout(() => V.room(id), 1600); } catch (err) { fail('#cmsg', err); } };
  document.querySelectorAll('[data-do]').forEach(b => b.onclick = () => { const j = jobs.find(x => x.id === b.dataset.do);
    $('#timerbox').innerHTML = `<div class="card form"><h3 style="margin:0">${E(j.name)}</h3><label>How long do you want? <select id="mins">${[5, 10, 15, 20, 30, 45, 60].map(m => `<option ${m === 15 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
<button class="btn" id="go">Start the timer</button><p id="tmsg" role="status"></p></div>`; $('#timerbox').scrollIntoView({ behavior: 'smooth' });
    $('#go').onclick = async () => { try {
      await API.call('/rest/v1/activity?on_conflict=member_id', { method: 'POST', body: { member_id: ctx.me.id, family_id: ctx.family.id, room_id: r.id, job_id: j.id }, headers: { Prefer: 'resolution=merge-duplicates' } });
      await API.rpc('start_timer', { job: j.id, minutes: +$('#mins').value }); $('#tmsg').className = 'ok';
      $('#tmsg').textContent = Voice.say({ personality: me.personality, outfit: me.outfit }, 'start', { chore: j.name.toLowerCase() }).text; setTimeout(() => V.room(id), 1600);
    } catch (err) { fail('#tmsg', err); } }; });
};

V.about = async () => {
  const rows = Object.entries(PWA.state.usage).sort((a, b) => b[1].minutes - a[1].minutes);
  frame(`<h1>About &amp; privacy</h1>
<div class="card"><h2>Privacy</h2><p>Your family's data lives in a private database that only signed-in family members can reach. Children can't see each other's money details, scores or photos. Only first names, emoji and age groups are stored about people; children have no email. Proof photos are private (you and parents only). No ads, no tracking, no cookies.</p></div>
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
  routes: { board: guard(V.board), family: guard(V.family), money: guard(V.money), setup: guard(V.setup), about: guard(V.about), avatar: guard(V.avatar), rooms: guard(V.rooms), room: guard(V.room),
    signin: tab => (API.userId() ? PWA.go('#/') : signIn(tab || 'kid')) }
});
start();
