// Behaviour test for the room scenes: wake-up, one task at a time, no auto-complete, photo → colour, fatigue,
// 8-hour reminder, poke, shake, drop. node test-scene.mjs http://localhost:8080/scene.html <shots-dir>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const [url, out] = process.argv.slice(2);
const port = 9621, prof = mkdtempSync(join(tmpdir(), 'scn-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(250); } }
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}, errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) pending[d.id](d); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(e + ' → ' + r.result.exceptionDetails.exception?.description); return r.result.result.value; };
const shot = async name => { await sleep(300); const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 430, height: 620, scale: 1 } }); writeFileSync(join(out, name + '.png'), Buffer.from(r.result.data, 'base64')); };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const st = n => ev(`(() => { const a = agents[${n}]; return { s: a.state, cur: a.cur, room: a.room, z: +a.z.toFixed(2) }; })()`);
const bubbles = () => ev(`[...document.querySelectorAll('#svg text')].filter(t => t.closest('g') && t.closest('g').getAttribute('opacity') === '1').map(t => t.textContent)`);
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 930, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url }); await sleep(1500);

ok((await st(0)).s === 'sleep' && (await st(0)).z > 0.5, 'Bear Cub starts asleep in bed in her bedroom');
ok(await ev(`document.getElementById('cpct').textContent`) === '0%', 'rooms start as uncoloured line art (0%)');
await shot('1-asleep');
await sleep(4500);
const s1 = await st(0); ok(['hop', 'stretch', 'walk', 'work'].includes(s1.s), `she wakes, hops out of bed and gets going (${s1.s})`);
await sleep(5000);
const s2 = await st(0); ok(s2.cur === 'bedroom:bed', 'first task on her plan: Make the bed');
await shot('2-making-bed');
await sleep(12000);
ok((await st(0)).cur === 'bedroom:bed' && (await st(0)).s === 'work', 'after 12 more seconds she is STILL making the bed (no auto-complete, no skipping)');
await ev(`poke(agents[0])`); await sleep(300);
const pb = (await bubbles()).join(' | '); ok(pb.length > 0, 'poke → she reacts in character: "' + pb + '"');
await sleep(2000);
const nb = (await bubbles()).join(' | '); ok(/bed/i.test(nb), 'then nudges back to her task: "' + nb + '"');
await ev(`submitPhoto(agents[0], 5)`); await sleep(500);
ok(await ev(`level['bedroom:bed']`) === 5 && await ev(`+document.querySelector('image[href$="item-bed.webp"]').getAttribute('opacity')`) === 1, 'photo scored 5★ → the bed is in full colour');
ok(await ev(`document.getElementById('cpct').textContent`) === '33%', 'room colour meter rises to 33%');
await sleep(2500);
ok((await st(0)).cur === 'bedroom:toys', 'only then does she move on to the next task (pick up the floor)');
await ev(`submitPhoto(agents[0], 2)`); await sleep(400);
ok(Math.abs(await ev(`+document.querySelector('image[href$="item-toys.webp"]').getAttribute('opacity')`) - 0.4) < 0.01, '2★ → the toys are only faintly coloured (40%)');
await shot('3-coloured');
await sleep(9000);
const s3 = await st(0); ok(s3.room === 'kitchen' && s3.cur === 'kitchen:island', 'she walks out to the kitchen for her next task');
ok(await ev(`view`) === 'kitchen', 'the view follows her into the kitchen');
await ev(`startTask(agents[0], 'kitchen:fridge')`); await sleep(200);
ok((await st(0)).cur === 'kitchen:fridge' && await ev(`agents.filter(a => a.cur).every(a => typeof a.cur === 'string')`), 'switching task replaces it: still exactly one task at a time');
// tiredness
const f0 = await ev(`fatigue(agents[1])`);
await ev(`offsetMs = 9 * 3600e3`); await sleep(1500);
const f1 = await ev(`fatigue(agents[1])`);
ok(f0 === 0 && f1 > 0.95, `9 hours past the plan → Big Mike is worn out (fatigue ${f1.toFixed(2)})`);
ok(await ev(`agents[1].warned8h`) === true && /8 hours past/.test(await ev(`document.getElementById('toast').innerText`)), '8 hours past the planned finish → reminder from his avatar');
ok(+(await ev(`agents[1].cm.getAttribute('values')`)) < 0.35, 'his colour drains when worn out');
await shot('4-tired');
await ev(`submitPhoto(agents[1], 4)`); await sleep(400);
ok(await ev(`fatigue(agents[1])`) === 0 && await ev(`agents[1].refreshed > 0`), 'finishing the task refreshes him (fatigue back to 0)');
await ev(`offsetMs = 0`);
// shake + drop
await ev(`shake(1.5)`); await sleep(400);
ok(await ev(`agents.some(a => a.wobble > 0)`), 'shake → everyone wobbles');
await sleep(2500);
const sb = (await bubbles()).join(' | '); ok(sb.length > 0, 'and they steer back to their tasks: "' + sb + '"');
await ev(`agents[1].state = 'falling'; agents[1].z = 1.6; agents[1].vz = 0`); await sleep(2000);
ok((await st(1)).z === 0, 'dropped from a height → he falls, bounces and lands');
const props0 = await ev(`ROOMS.kitchen.props.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')`);
await ev(`ROOMS.kitchen.props[0].vx = 3`); await sleep(1200);
ok(await ev(`ROOMS.kitchen.props.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')`) !== props0, 'loose objects move when hit');
await shot('5-after-shake');
// add-ons, free time, out and back, bed
await ev(`offsetMs = (() => { const d = new Date(); return ((12 - d.getHours()) * 60 - d.getMinutes()) * 60000; })(); OUT_MS = 4000`);   // midday
const mike = 1;
await ev(`logAddon(agents[${mike}], 0)`); await sleep(300);
ok(await ev(`agents[${mike}].addons[0].logs[0].status`) === 'held' && await ev(`agents[${mike}].bonus`) === 0, 'parent-valued add-on (water) is held while chores remain');
await ev(`logAddon(agents[${mike}], 1)`);
ok(await ev(`agents[${mike}].addons[1].logs[0].status`) === 'logged', 'own add-on (study) is logged for them, no money');
await ev(`rewardAddon(agents[${mike}], 1, 100)`);
ok(await ev(`agents[${mike}].bonus`) === 100, 'a parent can still reward an own add-on ($1)');
await ev(`addOwnAddon(agents[${mike}], 'Eat dinner together')`);
ok(await ev(`agents[${mike}].addons.length`) === 3 && /Eat dinner together/.test(await ev(`document.getElementById('people').innerText`)), 'people can add their own add-ons');
for (let i = 0; i < 12 && await ev(`agents[${mike}].plan.length`) > 0; i++) { await ev(`if (!agents[${mike}].cur) startNext(agents[${mike}]); submitPhoto(agents[${mike}], 5)`); await sleep(1700); }
ok(await ev(`agents[${mike}].plan.length`) === 0, 'all his chores done (each with a photo)');
await sleep(800);
ok(await ev(`agents[${mike}].addons[0].logs[0].status`) === 'released' && await ev(`agents[${mike}].bonus`) === 150, 'chores done → the held water bonus unlocks ($0.50)');
const freeSt = await ev(`agents[${mike}].state`); ok(['leaving', 'walk', 'out'].includes(freeSt) && await ev(`agents[${mike}].dest && agents[${mike}].dest.then`) === 'out' || freeSt === 'out', `midday, chores done → he heads out of the house (${freeSt})`);
for (let i = 0; i < 40 && await ev(`agents[${mike}].state`) !== 'out'; i++) await sleep(250);
ok(await ev(`agents[${mike}].state`) === 'out' && await ev(`agents[${mike}].v.root.getAttribute('display')`) === 'none', 'he leaves through the door and is gone from the house');
await shot('6-out');
for (let i = 0; i < 60 && await ev(`agents[${mike}].state`) === 'out'; i++) await sleep(250);
ok(await ev(`agents[${mike}].room`) === 'kitchen' && await ev(`agents[${mike}].state`) !== 'out', 'later he comes back home through the front door');
for (let i = 0; i < 120 && await ev(`agents[${mike}].state`) !== 'sleep'; i++) await sleep(250);
ok(await ev(`agents[${mike}].state`) === 'sleep' && await ev(`agents[${mike}].room`) === 'bedroom', 'then he walks to the bedroom and goes to sleep');
await ev(`view = 'bedroom'; drawRoom()`); await shot('7-bed');
await ev(`logAddon(agents[0], 0)`); await ev(`document.getElementById('push').click()`); await sleep(300);
ok(await ev(`agents[0].addons[0].logs[0].status`) === 'released', 'a parent can push held bonuses out early');
ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), 'no sideways scrolling on a 430px phone (with the add-on panel open)');
{ const y = await ev(`document.getElementById('people').getBoundingClientRect().top + scrollY`); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width: 430, height: 760, scale: 1 } }); writeFileSync(join(out, '8-panel.png'), Buffer.from(r.result.data, 'base64')); }
ok(errors.length === 0, 'no JavaScript errors ' + (errors.length ? JSON.stringify(errors) : ''));
await send('Browser.close').catch(() => {}); chrome.kill();
