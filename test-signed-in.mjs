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
};
const calls = [];
const filt = (rows, q) => { for (const [k, v] of q) { const m = /^eq\.(.*)$/.exec(v); if (m && k !== 'select') rows = rows.filter(r => String(r[k]) === m[1]); if (v === 'is.true') rows = rows.filter(r => r[k] === true); } return rows; };
function handle(method, url, body) {
  const u = new URL(url), path = u.pathname, q = [...u.searchParams];
  calls.push(method + ' ' + path.replace('/rest/v1', '') + (body ? ' ' + body.slice(0, 600) : ''));
  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.split('/').pop(), a = body ? JSON.parse(body) : {};
    return { balance: 1234, leaderboard: [], my_status: [], effective_pay: Math.round((db.jobs.find(j => j.id === a.job)?.pay_cents || 0) * 0.5 / 5) * 5,
      claim_room: (db.room_claims.push({ id: 'c1', room_id: a.room, week_start: a.week, member_id: ME.id, status: 'active', bonus_cents: 1500, penalty_cents: 2250 }), 'c1'),
      start_timer: 't1', load_starter_chores: '11 rooms and 37 chores loaded', create_invite: 'ABCDE12345', decide_member: null }[fn] ?? null;
  }
  const t = path.replace('/rest/v1/', '');
  if (!db[t]) return [];
  if (method === 'GET') return filt(db[t], q);
  if (method === 'POST') { const row = JSON.parse(body); const key = t === 'avatars' || t === 'activity' ? 'member_id' : 'id'; db[t] = db[t].filter(r => r[key] !== row[key]); db[t].push(row); return [row]; }
  if (method === 'PATCH') { const rows = filt(db[t], q); rows.forEach(r => Object.assign(r, JSON.parse(body))); return rows; }
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
ok(calls.some(c => c.startsWith('POST /activity')) && calls.some(c => c.startsWith('POST /rpc/start_timer')), 'starting a chore sets your activity and a timer');
await sleep(1500);
await shot('4-room', 1100);

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
