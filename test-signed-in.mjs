// Signed-in UI test against a SIMULATED Supabase (Chrome DevTools Fetch interception). No real data is touched.
//   node test-signed-in.mjs http://localhost:8080/ <screenshot-dir>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const [base, out] = process.argv.slice(2);
const UID = '11111111-1111-1111-1111-111111111111', FAM = 'f0000000-0000-0000-0000-000000000001';
const ME = { id: 'm1', family_id: FAM, user_id: UID, display_name: 'Pat', emoji: '🧑', role: 'parent', age_group: 'adult', active: true, is_admin: true, status: 'active', username: null, device_restricted: false };
const db = {
  families: [{ id: FAM, name: 'Test Family' }],
  members: [ME, { id: 'm2', family_id: FAM, user_id: 'u2', display_name: 'Kai', emoji: '🦊', role: 'child', age_group: 'teen', active: true, status: 'active', username: 'kai' },
    { id: 'm3', family_id: FAM, user_id: null, display_name: 'Sitter', emoji: '🙂', role: 'caregiver', age_group: 'adult', active: true, status: 'pending', guest_label: 'Babysitter Sat' }],
  settings: [{ family_id: FAM, week_start: 0, currency: 'USD', pay_percent: 50, bonus_percent: 100, penalty_percent: 100, round_to_cents: 5, board_rank_by: 'points', board_parents: false, approve_swaps: true, kid_idle_minutes: 30, ai_voice: false, ai_daily_lines: 20, ai_monthly_cap_cents: 300 }],
  rooms: [['r1', 'Kitchen', '🍳', 6000, 1500], ['r2', 'Living room', '🛋️', 3000, 1000], ['r3', 'Main bathroom', '🛁', 4000, 1000], ['r4', 'Yard and outside', '🌳', 5000, 2000], ['r5', "Kai's bedroom", '🛏️', 2000, 1000]]
    .map(([id, name, emoji, v, b], i) => ({ id, family_id: FAM, name, emoji, weekly_value_cents: v, whole_bonus_cents: b, whole_penalty_cents: b * 1.5, position: i, active: true })),
  jobs: [['j1', 'r1', 'Wash the dishes', '🍽️', 300, 'daily', 'kid'], ['j2', 'r1', 'Wipe counters and stovetop', '🧽', 100, 'daily', 'kid'], ['j3', 'r1', 'Clean out the fridge', '🧊', 350, 'weekly', 'teen'],
    ['j4', 'r2', 'Vacuum', '🌀', 500, 'weekly', 'kid'], ['j5', 'r4', 'Mow the lawn', '🌱', 1500, 'weekly', 'teen']]
    .map(([id, room_id, name, emoji, pay_cents, freq, min_age], i) => ({ id, family_id: FAM, room_id, name, emoji, pay_cents, freq, every_n: 3, min_age, parents_in: id === 'j1' || id === 'j2', is_project: false, kind: 'work', active: true, position: i })),
  avatars: [], room_claims: [], activity: [], scores: [], penalties: [], payouts: [],
  tasks: [{ id: 't1', job_id: 'j1', family_id: FAM, name: 'Dishes washed and racked', standard_5: 'Every dish clean', weight: 1, position: 0 },
          { id: 't2', job_id: 'j1', family_id: FAM, name: 'Sink and drain cleared', standard_5: 'Sink empty and wiped', weight: 1, position: 1 }],
  submissions: [], item_state: [], addons: [], addon_logs: [],
};
const now = () => new Date().toISOString();
const rpcs = {
  start_task: a => { const j = db.jobs.find(x => x.id === a.job); db.activity = db.activity.filter(r => r.member_id !== ME.id);
    db.activity.push({ member_id: ME.id, family_id: FAM, room_id: j.room_id, job_id: j.id, started_at: now(), planned_end: new Date(Date.now() + a.minutes * 60000).toISOString() }); return null; },
  approve_scores: a => { const sub = db.submissions.find(x => x.id === a.sub); const v = Object.values(a.task_scores); const lvl = Math.round(v.reduce((m, n) => m + n, 0) / v.length);
    sub.status = 'approved'; db.item_state = db.item_state.filter(r => r.job_id !== sub.job_id); db.item_state.push({ job_id: sub.job_id, family_id: FAM, level: lvl, member_id: sub.member_id, updated_at: now() });
    db.activity = db.activity.filter(r => !(r.member_id === sub.member_id && r.job_id === sub.job_id)); return 150; },
  add_my_addon: a => { const id = 'a' + (db.addons.length + 1); db.addons.push({ id, family_id: FAM, member_id: ME.id, name: a.name, emoji: '⭐', source: 'self', value_cents: 0, per_day: 1, unlock: 'now', active: true }); return id; },
  add_family_addon: a => { const id = 'a' + (db.addons.length + 1); db.addons.push({ id, family_id: FAM, member_id: a.member, name: a.name, emoji: '⭐', source: 'parent', value_cents: a.value_cents, per_day: 1, unlock: a.unlock, unlock_at: a.unlock_at, active: true }); return id; },
  log_addon: a => { const ad = db.addons.find(x => x.id === a.addon); const st = ad.value_cents ? (db.activity.some(r => r.member_id === ME.id) ? 'held' : 'released') : 'logged';
    db.addon_logs.unshift({ id: 'l' + (db.addon_logs.length + 1), addon_id: ad.id, family_id: FAM, member_id: ME.id, done_on: new Date().toLocaleDateString('en-CA'), status: st, reward_cents: st === 'released' ? ad.value_cents : 0 }); return st; },
  reward_addon: a => { const l = db.addon_logs.find(x => x.id === a.log); l.status = 'released'; l.reward_cents = a.cents; return null; },
  push_addon: a => { let n = 0; db.addon_logs.filter(l => l.addon_id === a.addon && l.status === 'held').forEach(l => { l.status = 'released'; n++; }); return n; },
};
const calls = [];
const filt = (rows, q) => { for (const [k, v] of q) { const m = /^eq\.(.*)$/.exec(v); if (m && k !== 'select') rows = rows.filter(r => String(r[k]) === m[1]); if (v === 'is.true') rows = rows.filter(r => r[k] === true); } return rows; };
function handle(method, url, body) {
  const u = new URL(url), path = u.pathname, q = [...u.searchParams];
  calls.push(method + ' ' + path.replace('/rest/v1', '') + (body ? ' ' + body.slice(0, 600) : ''));
  if (path.startsWith('/storage/v1/object/sign/')) return { signedURL: '/object/sign/proofs/x.jpg?token=t' };
  if (path.startsWith('/storage/v1/object/')) return { Key: path.slice(19) };
  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.split('/').pop(), a = body ? JSON.parse(body) : {};
    if (rpcs[fn]) return rpcs[fn](a);
    return { balance: 1234, leaderboard: [], my_status: [], effective_pay: Math.round((db.jobs.find(j => j.id === a.job)?.pay_cents || 0) * 0.5 / 5) * 5,
      claim_room: (db.room_claims.push({ id: 'c1', room_id: a.room, week_start: a.week, member_id: ME.id, status: 'active', bonus_cents: 1500, penalty_cents: 2250 }), 'c1'),
      start_timer: 't1', load_starter_chores: '11 rooms and 37 chores loaded', create_invite: 'ABCDE12345', decide_member: null }[fn] ?? null;
  }
  const t = path.replace('/rest/v1/', '');
  if (!db[t]) return [];
  if (method === 'GET') return filt(db[t], q);
  if (method === 'POST') { const row = JSON.parse(body); if (t === 'submissions') row.status = row.status || 'submitted'; const key = t === 'avatars' || t === 'activity' ? 'member_id' : 'id'; db[t] = db[t].filter(r => r[key] !== row[key]); db[t].push(row); return [row]; }
  if (method === 'PATCH') { const rows = filt(db[t], q); rows.forEach(r => Object.assign(r, JSON.parse(body))); return rows; }
  if (method === 'DELETE') { const rows = filt(db[t], q); db[t] = db[t].filter(r => !rows.includes(r)); return null; }
  return [];
}

const port = 9611, prof = mkdtempSync(join(tmpdir(), 'fc-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(250); } }
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}, errors = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = async m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) pending[d.id](d);
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Fetch.requestPaused') { const r = d.params.request;
    const hdr = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }, { name: 'Content-Type', value: 'application/json' }];
    if (r.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 204, responseHeaders: hdr });
    const res = handle(r.method, r.url, r.postData);
    send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: hdr, body: Buffer.from(JSON.stringify(res)).toString('base64') }); } };
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(e + ' → ' + r.result.exceptionDetails.exception?.description); return r.result.result.value; };
const shot = async (name, h = 844) => { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: h, deviceScaleFactor: 1, mobile: true }); await sleep(700);
  const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, name + '.png'), Buffer.from(r.result.data, 'base64')); };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const go = async (hash, wait = 1500) => { await ev(`location.hash = '${hash}'`); await sleep(wait); };

await send('Runtime.enable'); await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: base }); await sleep(1200);
await ev(`localStorage.setItem('fc-session', JSON.stringify({ access_token: 'fake', refresh_token: 'fake', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '${UID}' } }))`);
await send('Page.reload'); await sleep(2500);

ok(await ev(`document.body.innerText.includes('Hi Pat')`), 'signed-in home loads from the (simulated) database');
ok(await ev(`!!document.querySelector('a[href="#/avatar"]')`), 'home invites you to make an avatar');
await shot('1-home');

await go('#/avatar');
await ev(`document.querySelector('#of').value = 'bear'; document.querySelector('#of').dispatchEvent(new Event('change'))`);
await ev(`document.querySelector('#pp').value = 'goofy'; document.querySelector('#pp').dispatchEvent(new Event('change'))`);
await ev(`document.querySelectorAll('#sk button')[5].click()`);
await shot('2-avatar');
await ev(`document.querySelector('#save').click()`); await sleep(800);
ok(calls.some(c => c.startsWith('POST /avatars') && c.includes('"outfit":"bear"') && c.includes('goofy')), 'avatar saved with bear costume and goofy personality');
ok(await ev(`document.querySelector('#amsg').className === 'ok'`), 'save confirmed in the avatar\'s voice: ' + await ev(`document.querySelector('#amsg').textContent`));

await go('#/rooms', 2000);
ok(await ev(`document.querySelectorAll('.wcard').length === 5`), 'wheel shows the 5 rooms');
const p1 = await ev(`document.querySelector('#rpanel h2').textContent`);
ok(/Kitchen/.test(p1) && await ev(`document.querySelector('#rpanel').innerText.includes('$30.00 a week')`), 'front room is the Kitchen at $30/week (pay dial 50%)');
await shot('3-rooms');
await ev(`document.querySelector('#wdn').click()`); await sleep(900);
ok(/Living room/.test(await ev(`document.querySelector('#rpanel h2').textContent`)), 'spinning the wheel brings the Living room to the front');
await ev(`document.querySelector('#wup').click()`); await sleep(900);

await go('#/room/r1', 2000);
ok(await ev(`document.querySelectorAll('[data-do]').length >= 2`), 'kitchen chores listed with "I\'ll do it"');
ok(await ev(`document.body.innerText.includes('$1.50')`), 'dishes show the dialled price ($3.00 × 50% = $1.50)');
await ev(`document.querySelector('#claim').click()`); await sleep(1000);
ok(calls.some(c => c.startsWith('POST /rpc/claim_room') && c.includes('"room":"r1"')), 'claiming the whole room calls claim_room for this week');
await sleep(1200);
ok(await ev(`document.body.innerText.includes('has the whole room this week')`), 'room shows the claim');
await ev(`document.querySelector('[data-do]').click()`); await sleep(400);
await ev(`document.querySelector('#go').click()`); await sleep(900);
ok(calls.some(c => c.startsWith('POST /rpc/start_task') && c.includes('"job":"j1"')), 'starting a chore calls start_task (one task at a time, with a planned finish)');
await sleep(1500);
const sc = `document.querySelector('iframe.scenebox').contentWindow.SceneState`;
for (let i = 0; i < 20 && !(await ev(`(() => { try { return ${sc}.agents.length > 0; } catch { return false; } })()`)); i++) await sleep(300);
ok(await ev(`!!document.querySelector('iframe.scenebox')`), 'the kitchen shows the live scene');
ok(await ev(`${sc}.agents.length === 1 && ${sc}.agents[0].cur === 'live:j1'`), "your avatar is in the scene, on your one real task (wash the dishes)");
ok(await ev(`Math.abs(${sc}.agents[0].plannedEnd - (Date.now() + 15 * 60e3)) < 120e3`), 'its planned finish comes from the database');
ok(await ev(`document.querySelector('iframe.scenebox').contentDocument.getElementById('cpct').textContent === '0%'`), 'kitchen starts as uncoloured line art');
await shot('4-room', 1100);
// photo → submission
await ev(`document.querySelector('[data-photo]').click()`); await sleep(400);
await ev(`(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; c.getContext('2d').fillRect(0, 0, 64, 48);
  const b = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'sink.png', { type: 'image/png' }));
  const i = document.querySelector('#ph'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`); await sleep(800);
ok(await ev(`!document.querySelector('#send').disabled && !document.querySelector('#phprev').hidden`), 'photo picked and previewed');
await ev(`document.querySelector('#send').click()`); await sleep(1200);
ok(calls.some(c => /^POST \/storage\/v1\/object\/proofs\/f0000000-0000-0000-0000-000000000001\/m1\/[0-9a-f-]+\/after\.jpg/.test(c)), 'photo uploaded privately to family/member/submission/after.jpg');
ok(calls.some(c => c.startsWith('POST /submissions') && c.includes('"after_path"') && c.includes('"tasks_done":["t1","t2"]')), 'submission created with the photo and its checklist');
await sleep(1500);
ok(await ev(`document.body.innerText.includes('waiting for a score')`), 'the chore now shows: photo in, waiting for a score');
ok(await ev(`${sc}.agents[0].cur === 'live:j1'`), 'the avatar keeps working until a parent scores it (not done yet)');
// parent scores it
await go('#/', 1500);
ok(await ev(`!!document.querySelector('a[href="#/review"]') && document.body.innerText.includes('1 photo to score')`), 'parents see "1 photo to score" on the home screen');
await go('#/review', 1500);
ok(await ev(`document.querySelectorAll('[data-score]').length === 2 && !!document.querySelector('img.proof')`), 'score screen shows the photo and the 2 checklist items');
await ev(`document.querySelector('[data-score="t2"]').value = '4'`);
await shot('6-review', 1300);
await ev(`document.querySelector('[data-ok]').click()`); await sleep(900);
ok(calls.some(c => c.startsWith('POST /rpc/approve_scores') && c.includes('"t1":5') && c.includes('"t2":4')), 'approve sends each task score');
await go('#/room/r1', 2000);
for (let i = 0; i < 20 && !(await ev(`(() => { try { return ${sc}.level['kitchen:sink'] === 5; } catch { return false; } })()`)); i++) await sleep(300);
ok(await ev(`${sc}.level['kitchen:sink'] === 5`), 'score approved → the sink is in full colour in the live scene');
ok(await ev(`document.body.innerText.includes('Scored today')`) && await ev(`${sc}.agents[0].cur === null`), 'chore shows Scored; your avatar is free for the next one');
await shot('7-coloured', 1100);
// add-ons
await go('#/addons', 1500);
ok(await ev(`document.querySelectorAll('.tabs a').length === 6 && document.documentElement.scrollWidth <= innerWidth`), 'Add-ons tab added; nothing scrolls sideways');
await ev(`{ document.querySelector('#fname').value = 'Drink 6 glasses of water'; document.querySelector('#fval').value = '0.50'; document.querySelector('#fam').requestSubmit(); }`); await sleep(1000);
ok(calls.some(c => c.startsWith('POST /rpc/add_family_addon') && c.includes('"value_cents":50') && c.includes('"unlock":"chores"') && c.includes('"member":null')), 'parent adds a $0.50 add-on for everyone, unlocked once chores are done');
await ev(`{ document.querySelector('#oname').value = 'Study 30 minutes'; document.querySelector('#own').requestSubmit(); }`); await sleep(1000);
ok(calls.some(c => c.startsWith('POST /rpc/add_my_addon') && c.includes('Study 30 minutes')), 'anyone can add their own add-on');
await ev(`document.querySelectorAll('[data-log]')[1].click()`); await sleep(2500);
ok(calls.some(c => c.startsWith('POST /rpc/log_addon')) && await ev(`!!document.querySelector('[data-reward]')`), 'own add-on logged; parents can reward it from the family log');
await ev(`document.querySelector('[data-reward]').click()`); await sleep(1000);
ok(calls.some(c => c.startsWith('POST /rpc/reward_addon') && c.includes('"cents":100')), 'parent rewards it ($1)');
await shot('8-addons', 1500);

await go('#/setup', 2000);
await ev(`document.querySelector('#invites').open = true`); await sleep(300);
ok(await ev(`document.querySelector('#invbox').innerText.includes('Babysitter Sat')`), 'pending babysitter request shown for approval');
await ev(`{ const f = document.querySelector('#if'); f.label.value = 'Grandma visit'; f.role.value = 'caregiver'; f.dur.value = 'temporary'; f.from.value = '2026-12-20T09:00'; f.until.value = '2026-12-27T20:00'; f.requestSubmit(); }`); await sleep(900);
ok(await ev(`document.querySelector('#imsg').innerText.includes('ABCDE12345')`), 'invite created, code shown with a Share button');
ok(calls.some(c => c.startsWith('POST /rpc/create_invite') && c.includes('Grandma visit') && c.includes('temporary')), 'invite sent with label, role and dates');
await ev(`document.querySelector('[data-ok]').click()`); await sleep(800);
ok(calls.some(c => c.startsWith('POST /rpc/decide_member') && c.includes('"approve":true')), 'approving the request calls decide_member');
await ev(`document.querySelectorAll('details').forEach(d => d.open = true)`); await sleep(300);
await ev(`{ const f2 = document.querySelector('#df'); f2.pay.value = 75; f2.requestSubmit(); }`); await sleep(900);
ok(calls.some(c => c.startsWith('PATCH /settings') && c.includes('"pay_percent":75')), 'money dial saved (pay 75%)');
await shot('5-setup', 1800);

ok(errors.length === 0, 'no JavaScript errors ' + (errors.length ? JSON.stringify(errors) : ''));
await send('Browser.close').catch(() => {}); chrome.kill();
