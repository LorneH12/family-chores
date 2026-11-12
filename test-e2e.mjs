import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const url = process.argv[2], out = process.argv[3];
const port = 9555, prof = mkdtempSync(join(tmpdir(), 'chores-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(250); } }
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}, errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) pending[d.id](d); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(e + ' → ' + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result.result.value; };
const shot = async (name, w = 390, h = 844) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 }); await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, name + '.png'), Buffer.from(r.result.data, 'base64')); };
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url }); await sleep(1500);

ok(await ev(`document.querySelectorAll('[data-me]').length === 5`), 'first run shows 5 sample people to pick');
await shot('1-who');
// pick Jo (teen)
await ev(`[...document.querySelectorAll('[data-me]')].find(b => b.textContent.includes('Jo')).click()`); await sleep(300);
ok(await ev(`document.querySelector('h1').textContent.includes('Jo')`), 'home greets the picked person');
await shot('2-today');

// rotation: for 4 consecutive weeks every weekly chore has exactly one eligible assignee, and assignees change week to week
const rot = await ev(`(() => { const S = PWA.state, res = []; const ws0 = S.settings.start;
  for (let w = 0; w < 4; w++) { const day = new Date(ws0); day.setDate(day.getDate() + 7 * w + 2);
    const k = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
    res.push(S.chores.filter(c => c.freq === 'weekly').map(c => { let who = null; for (const p of S.people) if (choresFor(p.id, k).some(x => x.c.id === c.id)) who = who ? 'DUP' : p.name; return c.name + ':' + who; })); }
  return res; })()`);
ok(rot.every(w => w.every(x => !x.endsWith(':null') && !x.includes('DUP'))), 'every weekly chore has exactly one person each week');
ok(JSON.stringify(rot[0]) !== JSON.stringify(rot[1]), 'weekly assignments rotate between weeks');
const ageOK = await ev(`(() => { const S = PWA.state; const pip = S.people.find(p => p.name === 'Pip'); const k = '${new Date().toISOString().slice(0, 10)}';
  let bad = []; for (let d = 0; d < 21; d++) { const day = new Date(); day.setDate(day.getDate() + d);
    const kk = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
    choresFor(pip.id, kk).forEach(x => { if (x.c.minAge !== 'little') bad.push(x.c.name); }); } return bad; })()`);
ok(ageOK.length === 0, 'the little one only gets little-age chores over 3 weeks ' + (ageOK.length ? JSON.stringify(ageOK) : ''));
const parentsOut = await ev(`(() => { const S = PWA.state; const alex = S.people.find(p => p.name === 'Alex'); return choresFor(alex.id, S.settings.start).every(x => x.c.parents); })()`);
ok(parentsOut, 'parents only get chores marked "parents too"');

// mark first chore done as Jo
const before = await ev(`PWA.state.done.length`);
await ev(`document.querySelector('[data-done]').click()`); await sleep(200);
ok(await ev(`PWA.state.done.length`) === before + 1, 'Done records a completion');
ok(await ev(`PWA.state.done.at(-1).approved === false`), 'completion waits for parent approval (setting on)');

// swap: Jo asks someone to take a chore
const hasSwap = await ev(`!!document.querySelector('[data-swap]')`);
if (hasSwap) {
  await ev(`document.querySelector('[data-swap]').click()`); await sleep(200);
  const target = await ev(`document.querySelector('#swapTo')?.selectedOptions[0]?.textContent || ''`);
  await ev(`document.querySelector('#swapGo').click()`); await sleep(200);
  ok(await ev(`PWA.state.swaps.length === 1 && PWA.state.swaps[0].status === 'asked'`), 'swap request created (to ' + target + ')');
  // switch phone identity to the target and accept
  const toId = await ev(`PWA.state.swaps[0].to`); const chore = await ev(`PWA.state.swaps[0].chore`), occ = await ev(`PWA.state.swaps[0].occ`);
  await ev(`PWA.state.me = '${toId}'; PWA.save(); location.hash = '#/swaps'; PWA.route()`); await sleep(300);
  await shot('3-swaps');
  await ev(`document.querySelector('[data-acc]').click()`); await sleep(200);
  ok(await ev(`PWA.state.swaps[0].status === 'accepted'`), 'target accepted');
  ok(await ev(`assignee(PWA.state.chores.find(c => c.id === '${chore}'), '${occ}') !== '${toId}'`), 'not reassigned until a parent approves');
  // parent approves
  const alex = await ev(`PWA.state.people.find(p => p.name === 'Alex').id`);
  await ev(`PWA.state.me = '${alex}'; PWA.save(); location.hash = '#/swaps'; PWA.route()`); await sleep(300);
  await ev(`document.querySelector('[data-app]').click()`); await sleep(200);
  ok(await ev(`assignee(PWA.state.chores.find(c => c.id === '${chore}'), '${occ}') === '${toId}'`), 'after parent approval the chore moves to the new person');
} else console.log('SKIP swap (no swappable chore today)');

// parent approves Jo's done, records payout
const alex = await ev(`PWA.state.people.find(p => p.name === 'Alex').id`);
await ev(`PWA.state.me = '${alex}'; PWA.save(); location.hash = '#/family'; PWA.route()`); await sleep(300);
await shot('4-family');
await ev(`document.querySelector('[data-ok]').click()`); await sleep(200);
const jo = await ev(`PWA.state.people.find(p => p.name === 'Jo').id`);
const bal = await ev(`earned('${jo}') - paid('${jo}')`);
ok(bal > 0, 'approved chore adds to Jo balance (' + bal + ' cents)');
await ev(`location.hash = '#/money'; PWA.route()`); await sleep(300);
await ev(`const f = document.querySelector('#pay'); f.p.value = '${jo}'; f.a.value = (${bal} / 100).toFixed(2); f.requestSubmit()`); await sleep(200);
ok(await ev(`earned('${jo}') - paid('${jo}') === 0`), 'payout brings the balance to zero');
await shot('5-money');
await ev(`location.hash = '#/setup'; PWA.route()`); await sleep(300);
await shot('6-setup');
await ev(`location.hash = '#/'; PWA.route()`); await sleep(300);
await shot('7-laptop', 1440, 900);
// XSS: a malicious name must render as text
await ev(`PWA.state.people[0].name = '<img src=x onerror=window.__x=1>'; PWA.save(); location.hash = '#/family'; PWA.route()`); await sleep(300);
ok(await ev(`!window.__x && !document.querySelector('#app img')`), 'names are escaped (no HTML injection)');
ok(errors.length === 0, 'no JavaScript errors ' + (errors.length ? JSON.stringify(errors) : ''));
await send('Browser.close').catch(() => {}); chrome.kill();
