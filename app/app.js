// Family Chores: stage 1 (one device). Same data model as the planned shared database.
const $ = s => document.querySelector(s), E = s => PWA.esc(s);
const AGES = [['little', 'Little (4–7)'], ['kid', 'Kid (8–12)'], ['teen', 'Teen (13–17)'], ['adult', 'Adult']];
const RANK = { little: 0, kid: 1, teen: 2, adult: 3 };
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

// ---------- dates (local calendar days, no time-zone surprises) ----------
const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return key(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const today = () => key(new Date());
const weekStartOf = (k, ws) => { const d = parse(k); const diff = (d.getDay() - ws + 7) % 7; return addDays(k, -diff); };
const fmtDay = k => parse(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- sample family (fictional) ----------
function sample() {
  const P = [['Alex', '🧑', 'parent', 'adult'], ['Sam', '🧔', 'parent', 'adult'], ['Jo', '🦊', 'child', 'teen'], ['Kit', '🐼', 'child', 'kid'], ['Pip', '🐣', 'child', 'little']]
    .map(([name, emoji, role, age]) => ({ id: uid(), name, emoji, role, age, t: now() }));
  const C = [
    ['Wash the dishes', '🍽️', 'daily', 'daily', 50, 'kid', false], ['Set the table', '🍴', 'daily', 'daily', 25, 'little', false],
    ['Feed the pet', '🐟', 'daily', 'weekly', 25, 'little', false], ['Take out the bins', '🗑️', 'weekly', 'weekly', 100, 'kid', false],
    ['Vacuum the living room', '🧹', 'weekly', 'weekly', 200, 'kid', false], ['Fold the laundry', '👕', 'weekly', 'weekly', 150, 'kid', true],
    ['Clean the bathroom', '🛁', 'weekly', 'weekly', 300, 'teen', true], ['Mow the lawn', '🌱', 'weekly', 'weekly', 500, 'teen', true]
  ].map(([name, emoji, freq, rotate, value, minAge, parents]) => ({ id: uid(), name, emoji, freq, every: 3, rotate, rotEvery: 3, value, minAge, parents, fixed: null, t: now() }));
  return { people: P, chores: C, swaps: [], done: [], payouts: [], me: null,
    settings: { weekStart: 0, start: weekStartOf(today(), 0), approveSwaps: true, approveDone: true, currency: 'USD', pin: null } };
}

// ---------- rules ----------
const S = () => PWA.state;
const person = id => S().people.find(p => p.id === id);
const money = c => new Intl.NumberFormat(undefined, { style: 'currency', currency: S().settings.currency || 'USD' }).format((c || 0) / 100);
const eligible = c => S().people.filter(p => RANK[p.age] >= RANK[c.minAge] && (p.role === 'child' || c.parents)).sort((a, b) => RANK[b.age] - RANK[a.age] || a.name.localeCompare(b.name));
function occurrence(c, day) {            // the key of the occurrence covering `day`
  const st = S().settings;
  if (c.freq === 'daily') return day;
  if (c.freq === 'weekly') return weekStartOf(day, st.weekStart);
  const n = Math.max(1, c.every | 0); return addDays(st.start, Math.floor(daysBetween(st.start, day) / n) * n);
}
const occEnd = (c, occ) => c.freq === 'daily' ? occ : c.freq === 'weekly' ? addDays(occ, 6) : addDays(occ, Math.max(1, c.every | 0) - 1);
function rotationIndex(c, occ) {
  const st = S().settings, d = daysBetween(st.start, occ);
  if (c.rotate === 'daily') return d;
  if (c.rotate === 'weekly') return Math.floor(daysBetween(weekStartOf(st.start, st.weekStart), weekStartOf(occ, st.weekStart)) / 7);
  return Math.floor(d / Math.max(1, c.rotEvery | 0));
}
function baseAssignee(c, occ) {
  if (c.rotate === 'fixed') return c.fixed && person(c.fixed) ? c.fixed : null;
  const pool = eligible(c); if (!pool.length) return null;
  const offset = S().chores.indexOf(c);
  const i = ((rotationIndex(c, occ) + offset) % pool.length + pool.length) % pool.length;
  return pool[i].id;
}
const swapFor = (c, occ) => S().swaps.find(s => s.chore === c.id && s.occ === occ && (s.status === 'approved' || (s.status === 'accepted' && !S().settings.approveSwaps)));
const assignee = (c, occ) => (swapFor(c, occ) || {}).to || baseAssignee(c, occ);
const doneFor = (c, occ) => S().done.find(d => d.chore === c.id && d.occ === occ);
function choresFor(pid, day) {           // occurrences active on `day` assigned to pid
  return S().chores.map(c => ({ c, occ: occurrence(c, day) })).filter(({ c, occ }) => assignee(c, occ) === pid);
}
const earned = pid => S().done.filter(d => d.person === pid && d.approved).reduce((a, d) => a + d.value, 0);
const paid = pid => S().payouts.filter(p => p.person === pid).reduce((a, p) => a + p.amount, 0);
const isParent = () => person(S().me)?.role === 'parent';
let unlocked = false;
const parentOK = () => isParent() && (!S().settings.pin || unlocked);

// ---------- shared bits ----------
const save = () => { PWA.save(); };
function choreRow(c, occ, pid, opts = {}) {
  const d = doneFor(c, occ), mine = pid === S().me, sw = S().swaps.find(s => s.chore === c.id && s.occ === occ && s.status === 'asked');
  const due = c.freq === 'daily' ? '' : ` · by ${fmtDay(occEnd(c, occ))}`;
  let act = '';
  if (d) act = d.approved ? `<span class="tag ok">Done ✓</span>` : `<span class="tag wait">Done · awaiting OK</span>`;
  else if (mine && !opts.readonly) act = `<button class="mini" data-done="${c.id}|${occ}">Done</button>` + (sw ? `<span class="tag wait">Swap asked</span>` : `<button class="mini alt" data-swap="${c.id}|${occ}">Swap</button>`);
  return `<li class="row"><span class="emo" aria-hidden="true">${E(c.emoji)}</span><span class="grow"><b>${E(c.name)}</b><br><span class="muted">${money(c.value)}${due}${opts.who ? ' · ' + E(person(pid)?.name || 'nobody') : ''}</span></span><span class="acts">${act}</span></li>`;
}
function bindRows(after) {
  document.querySelectorAll('[data-done]').forEach(b => b.onclick = () => {
    const [cid, occ] = b.dataset.done.split('|'), c = S().chores.find(x => x.id === cid);
    S().done.push({ id: uid(), chore: cid, occ, person: S().me, at: now(), approved: !S().settings.approveDone, value: c.value, t: now() }); save(); after();
  });
  document.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => {
    const [cid, occ] = b.dataset.swap.split('|'), c = S().chores.find(x => x.id === cid);
    const others = eligible(c).filter(p => p.id !== S().me);
    b.closest('li').insertAdjacentHTML('afterend', `<li class="row swapbox"><label class="grow">Ask who to take "${E(c.name)}"?
<select id="swapTo">${others.map(p => `<option value="${p.id}">${E(p.emoji + ' ' + p.name)}</option>`).join('')}</select></label>
<span class="acts"><button class="mini" id="swapGo">Ask</button><button class="mini alt" id="swapX">Cancel</button></span></li>`);
    if (!others.length) $('#swapTo').outerHTML = '<span class="muted">Nobody else can do this chore.</span>';
    $('#swapX').onclick = after;
    $('#swapGo').onclick = () => { const to = $('#swapTo')?.value; if (!to) return;
      S().swaps.push({ id: uid(), chore: cid, occ, from: S().me, to, status: 'asked', at: now(), t: now() }); save(); after(); };
  });
}
function whoAmI() {
  $('#app').innerHTML = `<h1>Who's using this phone?</h1><p class="muted">Pick yourself. You can change it later in Setup.</p>
<ul class="list">${S().people.map(p => `<li><button class="pick" data-me="${p.id}"><span class="emo">${E(p.emoji)}</span>${E(p.name)}<span class="muted"> · ${p.role}</span></button></li>`).join('')}</ul>`;
  document.querySelectorAll('[data-me]').forEach(b => b.onclick = async () => {
    const p = person(b.dataset.me);
    if (p.role === 'parent' && S().settings.pin) { const pin = prompt('Parent PIN for ' + p.name); if (!pin || await hash(pin) !== S().settings.pin) return; unlocked = true; }
    S().me = p.id; save(); PWA.go('#/'); PWA.route(); });
}
const needMe = fn => (...a) => (S().me && person(S().me) ? fn(...a) : whoAmI());

// ---------- views ----------
const VIEWS = {};
const home = needMe(function () {
  const me = person(S().me), t = today(), mine = choresFor(me.id, t);
  const daily = mine.filter(x => x.c.freq === 'daily'), longer = mine.filter(x => x.c.freq !== 'daily');
  const incoming = S().swaps.filter(s => s.to === me.id && s.status === 'asked').length;
  const left = mine.filter(x => !doneFor(x.c, x.occ)).length;
  $('#app').innerHTML = `<h1>${E(me.emoji)} Hi ${E(me.name)}</h1>
<p class="muted">${fmtDay(t)} · ${left ? `${left} to do` : 'All done. Nice!'} · balance <b>${money(earned(me.id) - paid(me.id))}</b></p>
${incoming ? `<a class="card notice" href="#/swaps">🔁 ${incoming} swap request${incoming > 1 ? 's' : ''} waiting for you</a>` : ''}
<h2>Today</h2><ul class="list">${daily.map(x => choreRow(x.c, x.occ, me.id)).join('') || '<li class="muted">No daily chores today.</li>'}</ul>
<h2>This week</h2><ul class="list">${longer.map(x => choreRow(x.c, x.occ, me.id)).join('') || '<li class="muted">No weekly chores this week.</li>'}</ul>
<h2>Next week</h2><ul class="list">${choresFor(me.id, addDays(weekStartOf(t, S().settings.weekStart), 7)).filter(x => x.c.freq !== 'daily').map(x => choreRow(x.c, x.occ, me.id, { readonly: true })).join('') || '<li class="muted">Nothing weekly yet.</li>'}</ul>`;
  bindRows(home);
});

VIEWS.family = needMe(function (arg) {
  const t = today(), mode = arg === 'week' ? 'week' : 'today';
  const people = S().people;
  const body = people.map(p => {
    const list = choresFor(p.id, t).filter(x => mode === 'today' ? x.c.freq === 'daily' : x.c.freq !== 'daily');
    const done = list.filter(x => doneFor(x.c, x.occ)).length;
    return `<div class="card"><h3>${E(p.emoji)} ${E(p.name)} <span class="muted">${done}/${list.length} done</span></h3><ul class="list">${list.map(x => choreRow(x.c, x.occ, p.id, { readonly: p.id !== S().me })).join('') || '<li class="muted">Nothing.</li>'}</ul></div>`;
  }).join('');
  const toApprove = parentOK() ? S().done.filter(d => !d.approved) : [];
  $('#app').innerHTML = `<h1>Family</h1><nav class="seg" aria-label="Period"><a href="#/family" class="${mode === 'today' ? 'on' : ''}" ${mode === 'today' ? 'aria-current="page"' : ''}>Today</a><a href="#/family/week" class="${mode === 'week' ? 'on' : ''}" ${mode === 'week' ? 'aria-current="page"' : ''}>This week</a></nav>
${toApprove.length ? `<div class="card notice"><h3>To approve</h3><ul class="list">${toApprove.map(d => { const c = S().chores.find(x => x.id === d.chore); return `<li class="row"><span class="emo">${E(c?.emoji || '✔️')}</span><span class="grow"><b>${E(c?.name || 'Chore')}</b><br><span class="muted">${E(person(d.person)?.name || '')} · ${money(d.value)}</span></span><span class="acts"><button class="mini" data-ok="${d.id}">OK</button><button class="mini alt" data-no="${d.id}">Not done</button></span></li>`; }).join('')}</ul></div>` : ''}
${body}`;
  bindRows(() => VIEWS.family(arg));
  document.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => { const d = S().done.find(x => x.id === b.dataset.ok); d.approved = true; d.by = S().me; d.t = now(); save(); VIEWS.family(arg); });
  document.querySelectorAll('[data-no]').forEach(b => b.onclick = () => { S().done = S().done.filter(x => x.id !== b.dataset.no); save(); VIEWS.family(arg); });
});

VIEWS.swaps = needMe(function () {
  const me = S().me, ch = id => S().chores.find(c => c.id === id) || { name: '?', emoji: '' };
  const line = (s, acts) => `<li class="row"><span class="emo">${E(ch(s.chore).emoji)}</span><span class="grow"><b>${E(ch(s.chore).name)}</b> · ${ch(s.chore).freq === "daily" ? fmtDay(s.occ) : "week of " + fmtDay(s.occ)}<br><span class="muted">${E(person(s.from)?.name)} → ${E(person(s.to)?.name)} · ${s.status}</span></span><span class="acts">${acts}</span></li>`;
  const incoming = S().swaps.filter(s => s.to === me && s.status === 'asked');
  const outgoing = S().swaps.filter(s => s.from === me && ['asked', 'accepted'].includes(s.status));
  const approve = parentOK() && S().settings.approveSwaps ? S().swaps.filter(s => s.status === 'accepted') : [];
  const recent = S().swaps.filter(s => ['approved', 'declined'].includes(s.status) || (s.status === 'accepted' && !S().settings.approveSwaps)).slice(-8).reverse();
  $('#app').innerHTML = `<h1>Swaps</h1><p class="muted">Ask someone to take a chore. Whoever does it gets the money.${S().settings.approveSwaps ? ' A parent approves accepted swaps.' : ''}</p>
<h2>Asked of you</h2><ul class="list">${incoming.map(s => line(s, `<button class="mini" data-acc="${s.id}">Accept</button><button class="mini alt" data-dec="${s.id}">Decline</button>`)).join('') || '<li class="muted">None.</li>'}</ul>
${approve.length ? `<h2>To approve</h2><ul class="list">${approve.map(s => line(s, `<button class="mini" data-app="${s.id}">Approve</button><button class="mini alt" data-dec="${s.id}">Decline</button>`)).join('')}</ul>` : ''}
<h2>You asked</h2><ul class="list">${outgoing.map(s => line(s, `<button class="mini alt" data-can="${s.id}">Cancel</button>`)).join('') || '<li class="muted">None.</li>'}</ul>
<h2>Recent</h2><ul class="list">${recent.map(s => line(s, '')).join('') || '<li class="muted">No swaps yet.</li>'}</ul>`;
  const set = (attr, fn) => document.querySelectorAll(`[${attr}]`).forEach(b => b.onclick = () => { const s = S().swaps.find(x => x.id === b.getAttribute(attr)); fn(s); s.t = now(); save(); VIEWS.swaps(); });
  set('data-acc', s => s.status = 'accepted'); set('data-dec', s => s.status = 'declined');
  set('data-app', s => { s.status = 'approved'; s.by = S().me; }); set('data-can', s => s.status = 'declined');
});

VIEWS.money = needMe(function () {
  const rows = S().people.map(p => `<li class="row"><span class="emo">${E(p.emoji)}</span><span class="grow"><b>${E(p.name)}</b><br><span class="muted">earned ${money(earned(p.id))} · paid ${money(paid(p.id))}</span></span><b>${money(earned(p.id) - paid(p.id))}</b></li>`).join('');
  const hist = [...S().done.filter(d => d.approved).map(d => ({ at: d.at, txt: `${person(d.person)?.name}: ${(S().chores.find(c => c.id === d.chore) || {}).name}`, amt: d.value })),
    ...S().payouts.map(p => ({ at: p.at, txt: `Paid ${person(p.person)?.name}${p.note ? ' · ' + p.note : ''}`, amt: -p.amount }))].sort((a, b) => b.at - a.at).slice(0, 20);
  $('#app').innerHTML = `<h1>Money</h1><p class="muted">Tracking only: no real payments are made by the app.</p>
<h2>Balances</h2><ul class="list">${rows}</ul>
${parentOK() ? `<div class="card"><h2>Record a payout</h2><form id="pay" class="form">
<label>Who <select name="p">${S().people.filter(p => p.role === 'child').map(p => `<option value="${p.id}">${E(p.name)}</option>`).join('')}</select></label>
<label>Amount <input name="a" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>
<label>Note <input name="n" maxlength="60" placeholder="e.g. Saturday pocket money"></label><button class="btn">Record</button></form></div>`
    : isParent() ? `<p><a class="btn alt" href="#/setup">Unlock parent tools</a></p>` : ''}
<h2>History</h2><ul class="list">${hist.map(h => `<li class="row"><span class="grow">${E(h.txt)}<br><span class="muted">${new Date(h.at).toLocaleDateString()}</span></span><b class="${h.amt < 0 ? 'neg' : ''}">${money(h.amt)}</b></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul>`;
  const f = $('#pay'); if (f) f.onsubmit = e => { e.preventDefault(); const d = new FormData(f), amt = Math.round(parseFloat(d.get('a')) * 100);
    if (!(amt > 0)) return; S().payouts.push({ id: uid(), person: d.get('p'), amount: amt, note: String(d.get('n') || '').slice(0, 60), at: now(), by: S().me, t: now() }); save(); VIEWS.money(); };
});

VIEWS.setup = needMe(async function () {
  const st = S().settings;
  if (!isParent()) {
    $('#app').innerHTML = `<h1>Setup</h1><p>Parents set up people and chores.</p><div class="card"><h2>This phone</h2><p>You are ${E(person(S().me).emoji)} ${E(person(S().me).name)}.</p><button class="btn alt" id="switch">Change who's using this phone</button></div><p><a href="#/about">About, privacy &amp; sync</a></p>`;
    $('#switch').onclick = () => { S().me = null; save(); whoAmI(); }; return;
  }
  if (st.pin && !unlocked) {
    $('#app').innerHTML = `<h1>Parent tools</h1><form id="pinf" class="form card"><label>Parent PIN <input name="pin" type="password" inputmode="numeric" autocomplete="off" required></label><button class="btn">Unlock</button><p id="pinerr" class="muted" role="status"></p></form>`;
    $('#pinf').onsubmit = async e => { e.preventDefault(); if (await hash(new FormData(e.target).get('pin')) === st.pin) { unlocked = true; VIEWS.setup(); } else $('#pinerr').textContent = 'Wrong PIN.'; };
    return;
  }
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  $('#app').innerHTML = `<h1>Setup</h1>
${st.pin ? '' : '<p class="card notice">Set a parent PIN (Rotation &amp; rules) so children cannot approve their own chores or payouts.</p>'}
<details class="card" open><summary><h2>People</h2></summary><ul class="list">${S().people.map(p => `<li class="row"><span class="emo">${E(p.emoji)}</span><span class="grow"><b>${E(p.name)}</b><br><span class="muted">${p.role} · ${AGES.find(a => a[0] === p.age)[1]}</span></span><span class="acts"><button class="mini alt" data-ep="${p.id}">Edit</button></span></li>`).join('')}</ul><button class="btn alt" data-ep="new">Add person</button><div id="pform"></div></details>
<details class="card" open><summary><h2>Chores</h2></summary><ul class="list">${S().chores.map(c => `<li class="row"><span class="emo">${E(c.emoji)}</span><span class="grow"><b>${E(c.name)}</b><br><span class="muted">${money(c.value)} · ${c.freq === 'every' ? 'every ' + c.every + ' days' : c.freq} · rotates ${c.rotate === 'every' ? 'every ' + c.rotEvery + ' days' : c.rotate} · ${AGES.find(a => a[0] === c.minAge)[1]}+${c.parents ? ' · parents too' : ''}</span></span><span class="acts"><button class="mini alt" data-ec="${c.id}">Edit</button></span></li>`).join('')}</ul><button class="btn alt" data-ec="new">Add chore</button><div id="cform"></div></details>
<details class="card"><summary><h2>Rotation &amp; rules</h2></summary><form id="sets" class="form">
<label>Week starts <select name="ws">${opt('0', String(st.weekStart), 'Sunday')}${opt('1', String(st.weekStart), 'Monday')}</select></label>
<label>Rotation started <input name="start" type="date" value="${st.start}"></label>
<label class="chk"><input type="checkbox" name="as" ${st.approveSwaps ? 'checked' : ''}> A parent approves swaps</label>
<label class="chk"><input type="checkbox" name="ad" ${st.approveDone ? 'checked' : ''}> A parent approves "done" before it's paid</label>
<label>Currency <select name="cur">${['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD'].map(c => opt(c, st.currency, c)).join('')}</select></label>
<label>Parent PIN (optional, blank = none) <input name="pin" type="password" inputmode="numeric" autocomplete="new-password" placeholder="${st.pin ? 'PIN set: type a new one to change' : 'none'}"></label>
<button class="btn">Save</button> <span id="saved" class="muted" role="status"></span></form></details>
<div class="card"><h2>This phone &amp; data</h2><p>This phone is ${E(person(S().me).name)}.</p>
<button class="btn alt" id="switch">Change who's using this phone</button> <button class="btn alt" id="export">Download my data</button> <button class="btn alt" id="wipe">Delete all data</button>
<p><a href="#/about">About, privacy &amp; sync</a></p></div>`;
  $('#switch').onclick = () => { S().me = null; save(); whoAmI(); };
  $('#export').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ people: S().people, chores: S().chores, swaps: S().swaps, done: S().done, payouts: S().payouts, settings: { ...st, pin: undefined } }, null, 2)], { type: 'application/json' })); a.download = 'family-chores-data.json'; a.click(); };
  $('#wipe').onclick = () => { if (confirm('Delete all chores data on this phone? This cannot be undone.')) { const st0 = sample().settings, me = { id: uid(), name: 'Parent', emoji: '🧑', role: 'parent', age: 'adult', t: now() };
      Object.assign(PWA.state, { people: [me], chores: [], swaps: [], done: [], payouts: [], me: me.id, settings: st0, seeded: true }); save(); unlocked = false; VIEWS.setup(); } };
  $('#sets').onsubmit = async e => { e.preventDefault(); const d = new FormData(e.target);
    st.weekStart = +d.get('ws'); st.start = d.get('start') || st.start; st.approveSwaps = !!d.get('as'); st.approveDone = !!d.get('ad'); st.currency = d.get('cur');
    const pin = String(d.get('pin') || ''); if (pin) { st.pin = await hash(pin); unlocked = true; } save(); $('#saved').textContent = 'Saved.'; };
  document.querySelectorAll('[data-ep]').forEach(b => b.onclick = () => personForm(b.dataset.ep));
  document.querySelectorAll('[data-ec]').forEach(b => b.onclick = () => choreForm(b.dataset.ec));
});
async function hash(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('family-chores:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

function personForm(id) {
  const p = id === 'new' ? { name: '', emoji: '🙂', role: 'child', age: 'kid' } : person(id);
  $('#pform').innerHTML = `<form class="form" id="pf"><label>First name or nickname <input name="name" maxlength="24" required value="${E(p.name)}"></label>
<label>Emoji <input name="emoji" maxlength="4" value="${E(p.emoji)}"></label>
<label>Role <select name="role"><option value="child" ${p.role === 'child' ? 'selected' : ''}>Child</option><option value="parent" ${p.role === 'parent' ? 'selected' : ''}>Parent</option></select></label>
<label>Age group <select name="age">${AGES.map(([v, l]) => `<option value="${v}" ${p.age === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
<button class="btn">Save</button> ${id !== 'new' ? '<button type="button" class="btn alt" id="pdel">Remove</button>' : ''}</form>`;
  $('#pf').onsubmit = e => { e.preventDefault(); const d = new FormData(e.target);
    const v = { name: String(d.get('name')).trim().slice(0, 24), emoji: String(d.get('emoji') || '🙂').slice(0, 4), role: d.get('role'), age: d.get('age'), t: now() };
    if (!v.name) return; if (id === 'new') S().people.push({ id: uid(), ...v }); else Object.assign(p, v); save(); VIEWS.setup(); };
  const del = $('#pdel'); if (del) del.onclick = () => { if (id === S().me) return alert("You can't remove yourself."); if (confirm(`Remove ${p.name}? Their history stays in Money.`)) { S().people = S().people.filter(x => x.id !== id); save(); VIEWS.setup(); } };
}
function choreForm(id) {
  const c = id === 'new' ? { name: '', emoji: '✨', freq: 'weekly', every: 3, rotate: 'weekly', rotEvery: 3, value: 100, minAge: 'kid', parents: false, fixed: null } : S().chores.find(x => x.id === id);
  const o = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  $('#cform').innerHTML = `<form class="form" id="cf"><label>Chore <input name="name" maxlength="40" required value="${E(c.name)}"></label>
<label>Emoji <input name="emoji" maxlength="4" value="${E(c.emoji)}"></label>
<label>Pays <input name="value" type="number" min="0" step="0.05" inputmode="decimal" value="${(c.value / 100).toFixed(2)}"></label>
<label>How often <select name="freq">${o('daily', c.freq, 'Every day')}${o('weekly', c.freq, 'Once a week')}${o('every', c.freq, 'Every few days')}</select></label>
<label>Every how many days (if "every few days") <input name="every" type="number" min="2" max="30" value="${c.every}"></label>
<label>Who does it <select name="rotate">${o('daily', c.rotate, 'Rotates daily')}${o('weekly', c.rotate, 'Rotates weekly')}${o('every', c.rotate, 'Rotates every few days')}${o('fixed', c.rotate, 'Always the same person')}</select></label>
<label>Rotate every how many days (if "every few days") <input name="rotEvery" type="number" min="2" max="30" value="${c.rotEvery}"></label>
<label>Same person (if "always the same") <select name="fixed"><option value="">—</option>${S().people.map(p => o(p.id, c.fixed, E(p.name))).join('')}</select></label>
<label>Youngest age group <select name="minAge">${AGES.map(([v, l]) => o(v, c.minAge, l)).join('')}</select></label>
<label class="chk"><input type="checkbox" name="parents" ${c.parents ? 'checked' : ''}> Parents are in the rotation too</label>
<button class="btn">Save</button> ${id !== 'new' ? '<button type="button" class="btn alt" id="cdel">Remove</button>' : ''}</form>`;
  $('#cf').onsubmit = e => { e.preventDefault(); const d = new FormData(e.target);
    const v = { name: String(d.get('name')).trim().slice(0, 40), emoji: String(d.get('emoji') || '✨').slice(0, 4), value: Math.max(0, Math.round(parseFloat(d.get('value') || 0) * 100)),
      freq: d.get('freq'), every: Math.max(2, +d.get('every') || 3), rotate: d.get('rotate'), rotEvery: Math.max(2, +d.get('rotEvery') || 3), fixed: d.get('fixed') || null, minAge: d.get('minAge'), parents: !!d.get('parents'), t: now() };
    if (!v.name) return; if (id === 'new') S().chores.push({ id: uid(), ...v }); else Object.assign(c, v); save(); VIEWS.setup(); };
  const del = $('#cdel'); if (del) del.onclick = () => { if (confirm(`Remove "${c.name}"?`)) { S().chores = S().chores.filter(x => x.id !== id); save(); VIEWS.setup(); } };
}

VIEWS.about = function () {
  const rows = Object.entries(PWA.state.usage).sort((a, b) => b[1].minutes - a[1].minutes);
  $('#app').innerHTML = `<h1>About, privacy &amp; sync</h1>
<div class="card"><h2>Privacy</h2><p>This version keeps everything on this phone: first names or nicknames, emoji, age groups, chores, swaps and money records. Nothing is sent to a server; no cookies, no ads, no tracking. Parents can download or delete all data in Setup.</p>
<p class="muted">Coming next: a shared family database so every phone sees the same list. Before that, this page will say exactly what is stored, where, and how to delete it.</p></div>
<div class="card"><h2>Use it as an app (optional)</h2><p class="muted">${PWA.mode === 'app' ? 'You are in the app.' : 'Install app (Chrome/Edge, laptop or Android) or Safari → Share → Add to Home Screen.'}</p></div>
<div class="card"><h2>Copy to another device</h2><p class="muted">Until the shared database is ready, a sync link copies this phone's data to another device (it merges). Treat it like the data itself: send it only to family.</p>
<button class="btn" id="copy">Copy sync link</button> <span id="ok" class="muted" role="status"></span></div>
<div class="card"><h2>Where it's used</h2>${rows.map(([w, u]) => `<p><b>${E(w)}${w === PWA.where ? ' (here)' : ''}</b>: ${u.visits} visit${u.visits === 1 ? '' : 's'} · ${Math.round(u.minutes)} min · last ${u.last}</p>`).join('')}
<button class="btn alt" id="rep">Copy usage report</button></div>`;
  $('#copy').onclick = () => navigator.clipboard.writeText(PWA.syncLink()).then(() => { $('#ok').textContent = 'Copied.'; });
  $('#rep').onclick = () => navigator.clipboard.writeText(PWA.usageReport('Family Chores'));
};

// ---------- start ----------
PWA.init({
  key: 'family-chores-v1',
  defaults: Object.assign(sample(), { seeded: true }),
  home,
  routes: VIEWS,
  mergeApp: (o, St) => {
    for (const k of ['people', 'chores', 'swaps', 'done', 'payouts']) {
      const byId = new Map((St[k] || []).map(x => [x.id, x]));
      for (const x of (Array.isArray(o[k]) ? o[k] : [])) { if (!x || typeof x.id !== 'string') continue; const m = byId.get(x.id); if (!m || (x.t || 0) > (m.t || 0)) byId.set(x.id, x); }
      St[k] = [...byId.values()];
    }
    if (o.settings && !St.settings) St.settings = o.settings;
  }
});
PWA.syncFilter = st => ({ ...st, me: null, settings: { ...st.settings, pin: null } });
if (navigator.storage?.persist) navigator.storage.persist();
