// Room scenes v2 (prototype): colouring-book rooms that colour in by score, avatars that wake up in the bedroom,
// work one task at a time (never skipping or assuming done), tire when overdue, and live in a small physics world
// (mass, bumps, drag-to-lift and drop, poke, phone shake). Everything they say comes from voice.js.
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const rnd = a => a[Math.floor(Math.random() * a.length)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- projection (orthographic camera of the Blender rooms, angle 05) ----------
const CAM = [9.5, -9.5, 8.9], PX = 480 / 6.4, RIGHT = [0.7071, 0.7071, 0], UP = [-0.3747, 0.3747, 0.848], TH = -2 * Math.PI / 180, ROOTZ = -0.75;
function P(x, y, z = 0) {
  const c = Math.cos(TH), s = Math.sin(TH), X = x * c - y * s, Y = x * s + y * c, Z = z + ROOTZ, d = [X - CAM[0], Y - CAM[1], Z - CAM[2]];
  return [240 + (d[0] * RIGHT[0] + d[1] * RIGHT[1]) * PX, 240 - (d[0] * UP[0] + d[1] * UP[1] + d[2] * UP[2]) * PX];
}
const [O0, OX, OY] = [P(0, 0), P(1, 0), P(0, 1)];                 // screen → floor (z = 0) by inverting the linear map
function floorAt(px, py) { const a = OX[0] - O0[0], b = OY[0] - O0[0], c = OX[1] - O0[1], d = OY[1] - O0[1], det = a * d - b * c, u = px - O0[0], v = py - O0[1];
  return [(d * u - b * v) / det, (-c * u + a * v) / det]; }

// ---------- rooms ----------
const ROOMS = {
  bedroom: { title: '🛏️ Bear Cub\'s bedroom', items: ['bed', 'floor', 'nightstand', 'rug', 'toys', 'wardrobe'], door: [1.55, -1.7], bed: [0.6, 0.35, 0.65],
    solids: [[-0.15, -0.5, 1.35, 1.75], [-0.75, 1.27, -0.25, 1.75], [-1.95, -0.45, -1.25, 0.05]],
    tasks: [{ id: 'bed', name: 'Make the bed', items: ['bed'], spot: [-0.35, 0.2], act: 'scrub', minutes: 5 },
            { id: 'toys', name: 'Pick up the floor', items: ['toys', 'rug'], spot: [-0.55, -0.85], act: 'carry', minutes: 10 },
            { id: 'vacuum', name: 'Vacuum the bedroom', items: ['floor'], spot: [0.4, -0.95], act: 'sweep', minutes: 15, roam: true }],
    props: [{ kind: 'ball', x: 1.0, y: -1.2, z: 0, vx: 0, vy: 0, vz: 0, r: 0.12, mass: 0.4, color: '#e5534b' }] },
  kitchen: { title: '🍳 Kitchen', items: ['bin', 'counter', 'cupboard', 'floor', 'fridge', 'island', 'sink', 'stove'], door: [1.65, -1.75],
    solids: [[-1.75, 1.0, 1.75, 1.75], [-1.75, 0.95, -1.0, 1.75], [-1.4, -1.8, -0.4, 0.0], [1.35, -1.75, 1.85, -1.25]],
    tasks: [{ id: 'dishes', name: 'Wash the dishes', items: ['sink'], spot: [0.25, 0.8], act: 'scrub', minutes: 20 },
            { id: 'counters', name: 'Wipe counters and stovetop', items: ['counter', 'stove'], spot: [1.0, 0.8], act: 'scrub', minutes: 10 },
            { id: 'island', name: 'Wipe the island', items: ['island'], spot: [-0.15, -0.9], act: 'scrub', minutes: 5 },
            { id: 'floor', name: 'Sweep and mop the floor', items: ['floor'], spot: [0.55, -0.35], act: 'sweep', minutes: 25, roam: true },
            { id: 'fridge', name: 'Clean the fridge', items: ['fridge'], spot: [-0.75, 0.55], act: 'scrub', minutes: 15 },
            { id: 'trash', name: 'Empty the trash', items: ['bin'], spot: [1.1, -1.05], act: 'carry', minutes: 5, duo: 'alleyoop' },
            { id: 'putaway', name: 'Put the dishes away', items: ['cupboard'], spot: [-0.5, 0.78], act: 'reach', minutes: 10, duo: 'lift' }],
    props: [{ kind: 'ball', x: 0.6, y: -1.4, z: 0, vx: 0, vy: 0, vz: 0, r: 0.13, mass: 0.5, color: '#7cb7e8' },
            { kind: 'box', x: 0.15, y: -1.3, z: 0, vx: 0, vy: 0, vz: 0, r: 0.15, mass: 1.2, color: '#c98e5a' }] },
};
const TASK = {}; for (const [rid, r] of Object.entries(ROOMS)) r.tasks.forEach(t => { TASK[rid + ':' + t.id] = { ...t, room: rid }; });
const level = {};          // room:item → 0..5 (best score of the tasks that cover it); stays until an admin resets
let view = 'bedroom';
const defs = el('defs', {}, svg), layers = el('g', {}, svg), propsG = el('g', {}, svg), actors = el('g', {}, svg), fx = el('g', {}, svg);
const itemImg = {};
function drawRoom() {
  while (layers.firstChild) layers.removeChild(layers.firstChild);
  while (propsG.firstChild) propsG.removeChild(propsG.firstChild);
  const r = ROOMS[view];
  el('image', { href: `rooms/layers/${view}/line.webp`, x: 0, y: 0, width: 480, height: 480 }, layers);
  r.items.forEach(it => { itemImg[it] = el('image', { href: `rooms/layers/${view}/item-${it}.webp`, x: 0, y: 0, width: 480, height: 480, opacity: 0 }, layers); });
  r.props.forEach(p => { p.g = el('g', {}, propsG); });
  document.getElementById('roomtitle').textContent = r.title;
  document.querySelectorAll('[data-room]').forEach(b => b.setAttribute('aria-pressed', b.dataset.room === view));
  refreshColors();
}
const itemLevel = (room, it) => level[room + ':' + it] || 0;
function refreshColors() {
  const r = ROOMS[view]; let sum = 0, n = 0;
  r.items.forEach(it => { const L = itemLevel(view, it); itemImg[it].setAttribute('opacity', (L / 5).toFixed(2));
    itemImg[it].style.filter = L === 5 ? 'saturate(1.25) brightness(1.06)' : `saturate(${0.45 + L * 0.11})`; });
  r.tasks.forEach(t => { n += 5; sum += Math.max(...t.items.map(it => itemLevel(view, it))); });
  const pct = Math.round(sum / n * 100); document.getElementById('cbar').style.width = pct + '%'; document.getElementById('cpct').textContent = pct + '%';
}
function glints(now) {                                   // 5★ items shine: little star glints come and go
  if (reduce || Math.random() > 0.06) return;
  const r = ROOMS[view], shiny = r.items.filter(it => itemLevel(view, it) === 5); if (!shiny.length) return;
  const it = rnd(shiny), t = r.tasks.find(x => x.items.includes(it)); if (!t) return;
  const [x, y] = P(t.spot[0] + (Math.random() - 0.5) * 0.6, t.spot[1] + 0.5 + (Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 0.4);
  const g = el('path', { d: 'M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z', fill: '#fff8d6', stroke: '#f2a900', 'stroke-width': 0.6 }, fx);
  const t0 = now; (function step(t1) { const p = (t1 - t0) / 900; if (p > 1) { g.remove(); return; } g.setAttribute('transform', `translate(${x} ${y}) scale(${Math.sin(p * Math.PI)}) rotate(${p * 90})`); requestAnimationFrame(step); })(t0);
}

// ---------- voice ----------
const PROFILES = {};
const V = (a, intent, ctx = {}, short = true) => Voice.say({ personality: a.cfg.personality, outfit: a.cfg.outfit }, intent, { name: a.cfg.name, ...ctx },
  PROFILES[a.cfg.name] || (PROFILES[a.cfg.name] = Voice.freshProfile()), Math.random, short ? { short: true, max: 48 } : {}).text;

// ---------- clock (the prototype can fast-forward to show tiredness) ----------
let offsetMs = 0; const clockNow = () => Date.now() + offsetMs;

// ---------- characters ----------
const PRESETS = [
  { name: 'Bear Cub', size: 0.72, skin: '#8D5524', hair: 'puffs', outfit: 'bear', personality: 'goofy', plan: ['bedroom:bed', 'bedroom:toys', 'kitchen:island', 'kitchen:putaway'], start: 'asleep' },
  { name: 'Big Mike', size: 1.12, skin: '#4A2C17', hair: 'fade', outfit: 'gym', personality: 'hype', plan: ['kitchen:trash', 'kitchen:floor', 'kitchen:counters'], start: 'kitchen' },
  { name: 'Princess Zee', size: 0.95, skin: '#A0662F', hair: 'puffs', outfit: 'cape', personality: 'dramatic', plan: ['kitchen:fridge', 'kitchen:dishes'], start: 'kitchen' },
  { name: 'DJ Chill', size: 1.0, skin: '#6B4226', hair: 'locs', outfit: 'hoodie', personality: 'chill', plan: ['kitchen:dishes', 'kitchen:floor'], start: 'kitchen' },
  { name: 'Auntie Boss', size: 1.05, skin: '#7A4A2A', hair: 'wrap', outfit: 'apron', personality: 'bossy', plan: ['kitchen:counters', 'kitchen:putaway'], start: 'kitchen' },
  { name: 'Pajama Pops', size: 1.1, skin: '#5C3A21', hair: 'afro', outfit: 'robe', personality: 'cheerful', plan: ['bedroom:vacuum', 'kitchen:island'], start: 'kitchen' },
];
const SCALE = 1.35;
function setTool(a, kind) {
  const g = a.v.parts.tool; while (g.firstChild) g.removeChild(g.firstChild);
  if (kind === 'sponge') el('rect', { x: -4, y: 20, width: 9, height: 6, rx: 2, fill: '#ffc857' }, g);
  if (kind === 'broom') { el('rect', { x: -1, y: -6, width: 2.5, height: 40, fill: '#b9773f' }, g); el('path', { d: 'M-6 32 L7 32 L9 42 L-8 42 Z', fill: '#e8c547' }, g); }
  if (kind === 'bag') el('circle', { cx: 0, cy: 28, r: 7, fill: '#3b3b3b' }, g);
  if (kind === 'dish') el('ellipse', { cx: 0, cy: 22, rx: 8, ry: 3, fill: '#fff', stroke: '#b8ad9c' }, g);
}
function say(a, text, ms = 2400) {
  if (a.room !== view) return;
  const b = a.v.parts.bubble; while (b.firstChild) b.removeChild(b.firstChild);
  const w = Math.min(190, 14 + text.length * 5.6), h = 22, y = -96 * a.cfg.size * SCALE - 10;
  el('rect', { x: -w / 2, y: y - h, width: w, height: h, rx: 10, fill: '#fff', stroke: '#2b2b2b', 'stroke-width': 1 }, b);
  el('path', { d: `M-5 ${y} L0 ${y + 7} L5 ${y} Z`, fill: '#fff', stroke: '#2b2b2b', 'stroke-width': 1 }, b);
  const t = el('text', { x: 0, y: y - 7, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 700, 'font-family': 'Segoe UI, system-ui, sans-serif', fill: '#2b2b2b' }, b); t.textContent = text;
  b.setAttribute('opacity', 1); clearTimeout(a.sayT); a.sayT = setTimeout(() => b.setAttribute('opacity', 0), ms);
}
function sparkle(x, y, n = 12, col = '#ffc857') {
  if (reduce) return;
  for (let i = 0; i < n; i++) { const s = el('path', { d: 'M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z', fill: col }, fx);
    const ang = Math.random() * Math.PI * 2, r = 12 + Math.random() * 30, t0 = performance.now();
    (function step(t) { const p = (t - t0) / 750; if (p > 1) { s.remove(); return; } s.setAttribute('transform', `translate(${x + Math.cos(ang) * r * p} ${y + Math.sin(ang) * r * p - 12 * p}) scale(${1 - p})`); requestAnimationFrame(step); })(t0); }
}

// ---------- agents (one current task each; never auto-complete) ----------
const agents = []; let nextId = 1;
const doneTasks = new Set();
function addAgent(cfg) {
  if (agents.length >= 5) return;
  const id = nextId++, filter = el('filter', { id: 'tired' + id }, defs), cm = el('feColorMatrix', { type: 'saturate', values: 1 }, filter);
  const v = Avatar.draw(actors, cfg); v.root.setAttribute('filter', `url(#tired${id})`); v.root.style.cursor = 'grab';
  const a = { id, cfg, v, cm, x: 0, y: -1.5, z: 0, vx: 0, vy: 0, vz: 0, mass: 0.6 + cfg.size * cfg.size, r: 0.2 * cfg.size + 0.08,
    plan: [...cfg.plan], cur: null, state: 'idle', t: 0, phase: Math.random() * 6, facing: 1, lift: 0, wobble: 0, spin: 0, startedAt: 0, plannedEnd: 0, warned8h: false, refreshed: 0, busy: null, dest: null, outUntil: 0, wentOut: false, bonus: 0,
    addons: [{ n: 'Drink water', e: '💧', v: 50, by: 'parent', logs: [] }, { n: 'Study 30 min', e: '📚', v: 0, by: 'self', logs: [] }] };
  addHitbox(a);
  if (cfg.start === 'asleep') { a.room = 'bedroom'; [a.x, a.y] = ROOMS.bedroom.bed; a.z = ROOMS.bedroom.bed[2]; a.state = 'sleep'; }
  else { a.room = cfg.start; [a.x, a.y] = ROOMS[a.room].door; }
  agents.push(a);
  if (a.state !== 'sleep') startNext(a); else renderPeople();
}
const current = a => a.cur && TASK[a.cur];
function startTask(a, key, msg = true) {                     // the ONLY way a task becomes current (one at a time)
  a.cur = key; a.dest = null; const t = TASK[key];
  a.startedAt = clockNow(); a.plannedEnd = a.startedAt + t.minutes * 60000; a.warned8h = false; a.bestD = 9; a.stuckT = 0;
  setTool(a, { scrub: 'sponge', sweep: 'broom', carry: 'bag', reach: 'dish' }[t.act]);
  if (t.room !== a.room) { a.state = 'leaving'; a.target = [...ROOMS[a.room].door]; } else { a.state = 'walk'; a.target = [...t.spot]; }
  if (msg) say(a, V(a, 'start', { chore: t.name.toLowerCase() }));
  renderPeople();
}
function startNext(a) { const key = a.plan.find(k => !doneTasks.has(k)); if (key) startTask(a, key); else freeTime(a); }
// ---------- free time: chores finished → bonuses unlock, then out of the house for a while, or bed ----------
let OUT_MS = 20000;                                        // prototype: "a while" = 20 seconds
const isNight = () => { const h = new Date(clockNow()).getHours(); return h >= 20 || h < 6; };
function travel(a, room, spot, then) { a.dest = { room, spot, then }; a.bestD = 9; a.stuckT = 0;
  if (room === a.room) { a.state = 'walk'; a.target = [...spot]; } else { a.state = 'leaving'; a.target = [...ROOMS[a.room].door]; } }
function goBed(a) { say(a, V(a, 'bedtime', {})); travel(a, 'bedroom', [-0.35, 0.2], 'bed'); }
function goOut(a) { say(a, V(a, 'headout', {})); a.wentOut = true; a.dest = { room: 'outside', then: 'out' }; a.bestD = 9; a.stuckT = 0; a.state = 'leaving'; a.target = [...ROOMS[a.room].door]; }
function freeTime(a) {
  a.cur = null; setTool(a, null); releaseAddons(a);
  if (isNight() || a.wentOut) goBed(a); else goOut(a);
  renderPeople();
}
function arrive(a, d) {                                     // reached the end of a trip that wasn't a task
  if (d.then === 'bed') { const [bx, by, bz] = ROOMS.bedroom.bed; a.x = bx + (a.id % 2) * 0.25 - 0.1; a.y = by; a.z = bz; a.vx = a.vy = a.vz = 0; a.state = 'sleep'; a.yawned = 0; a.dest = null; renderPeople(); }
  else { a.state = 'idle'; a.dest = null; }
}
// ---------- add-ons: extras beyond chores. Valued ones (parent/app) are held until the chores are done ----------
function logAddon(a, i) {
  const ad = a.addons[i]; if (!ad) return;
  const held = ad.v > 0 && a.plan.length > 0, log = { status: ad.v > 0 ? (held ? 'held' : 'released') : 'logged', at: clockNow() };
  ad.logs.push(log); if (log.status === 'released') a.bonus += ad.v;
  if (a.room === view && a.state !== 'out') { const [x, y] = P(a.x, a.y, 1.2); sparkle(x, y, 8, '#9fd3e6'); }
  say(a, V(a, held ? 'held' : 'addon', { chore: ad.n.toLowerCase() }));
  if (log.status === 'released') toast(a, V(a, 'unlocked', { chore: ad.n.toLowerCase() }, false) + ` (+$${(ad.v / 100).toFixed(2)})`);
  renderPeople();
}
function releaseAddons(a, pushed = false) {
  let n = 0, cents = 0, names = [];
  a.addons.forEach(ad => ad.logs.forEach(l => { if (l.status === 'held' && (pushed || a.plan.length === 0)) { l.status = 'released'; n++; cents += ad.v; names.push(ad.n.toLowerCase()); } }));
  if (!n) return 0; a.bonus += cents;
  setTimeout(() => toast(a, V(a, 'unlocked', { chore: names[0] }, false) + ` (+$${(cents / 100).toFixed(2)})`), 1800);
  if (a.room === view && a.state !== 'out') { const [x, y] = P(a.x, a.y, 1.4); sparkle(x, y, 18, '#ffc857'); }
  return n;
}
function addOwnAddon(a, name) { name = name.trim().slice(0, 60); if (!name) return; a.addons.push({ n: name, e: '⭐', v: 0, by: 'self', logs: [] }); renderPeople(); }
function rewardAddon(a, i, cents) { const ad = a.addons[i]; const l = ad && ad.logs.find(x => x.status === 'logged'); if (!l) return;
  l.status = 'released'; l.reward = cents; a.bonus += cents; toast(a, V(a, 'praise', { chore: ad.n.toLowerCase() }, false) + ` (+$${(cents / 100).toFixed(2)} from a parent)`); renderPeople(); }
// a task counts as done ONLY when its photo is submitted and scored
function submitPhoto(a, stars) {
  const t = current(a); if (!t) return;
  t.items.forEach(it => { const k = t.room + ':' + it; level[k] = Math.max(level[k] || 0, stars); });
  doneTasks.add(a.cur); a.plan = a.plan.filter(k => k !== a.cur);
  if (t.room === view) { refreshColors(); const [x, y] = P(t.spot[0], t.spot[1] + 0.4, 1); sparkle(x, y, 10 + stars * 4, stars === 5 ? '#ffc857' : '#9fd3e6'); }
  a.refreshed = clockNow(); a.state = 'cheer'; a.t = 0; a.vz = 2.2; a.busy = null;                 // celebrate + rejuvenate
  say(a, V(a, stars >= 4 ? 'celebrate' : 'partial', { goal: t.name, chore: t.name.toLowerCase(), room: 'the ' + t.room }));
  toast(a, V(a, stars >= 4 ? 'praise' : 'partial', { chore: t.name.toLowerCase(), room: 'the ' + t.room }, false) + ` (${'★'.repeat(stars)}${'☆'.repeat(5 - stars)})`);
  a.cur = null; renderPeople();
}
// tiredness comes only from being past the planned finish
const fatigue = a => a.cur && a.state !== 'cheer' ? clamp((clockNow() - a.plannedEnd) / (8 * 3600e3), 0, 1) : 0;

// ---------- duo moves ----------
function tryDuo(a, t) {
  const partner = agents.find(o => o !== a && o.room === a.room && !o.busy && !['sleep', 'held', 'falling', 'wake'].includes(o.state));
  if (!partner) return;
  if (t.duo === 'alleyoop') { a.busy = partner.busy = { kind: 'alleyoop', A: a, B: partner, step: 'gather', t: 0 };
    partner.prev = partner.target; partner.target = [1.25, -1.15]; partner.state = 'walk'; partner.bestD = 9; say(partner, V(partner, 'catchcall', { name: a.cfg.name })); }
  if (t.duo === 'lift') { const small = a.cfg.size < partner.cfg.size ? a : partner, big = small === a ? partner : a;
    if (big.cfg.size - small.cfg.size < 0.15) return;
    a.busy = partner.busy = { kind: 'lift', big, small, owner: a, step: 'gather', t: 0 };
    big.prev = big.target; small.prev = small.target; big.target = [t.spot[0] + 0.05, t.spot[1] - 0.25]; small.target = [...t.spot];
    big.state = small.state = 'walk'; big.bestD = small.bestD = 9; say(big, V(big, 'liftoffer', { name: small.cfg.name })); }
}
function runDuo(d, dt) {
  d.t += dt;
  if (d.kind === 'alleyoop') { const { A, B } = d;
    if (d.step === 'gather' && A.state === 'work' && B.state === 'work') { d.step = 'throw'; d.t = 0; say(A, V(A, 'throwcall', { name: B.cfg.name })); d.ball = el('circle', { r: 6, fill: '#3b3b3b' }, fx); }
    if (d.step === 'throw') { const p = Math.min(1, d.t / 1.1), [ax, ay] = P(A.x, A.y, 1.0), [bx, by] = P(1.6, -1.5, 0.9);
      d.ball.setAttribute('cx', ax + (bx - ax) * p); d.ball.setAttribute('cy', ay + (by - ay) * p - Math.sin(p * Math.PI) * 80); if (d.t < 0.05) B.vz = 2.6;
      if (p >= 1) { d.step = 'done'; d.t = 0; say(B, V(B, 'dunk', {})); d.ball.remove(); const [x, y] = P(1.6, -1.5, 0.6); sparkle(x, y, 14); } }
    if (d.step === 'done' && d.t > 0.8) { A.busy = B.busy = null; B.target = B.prev || [B.x, B.y]; B.state = B.cur ? 'walk' : 'idle'; say(A, V(A, 'highfive', { name: B.cfg.name })); }
  }
  if (d.kind === 'lift') { const { big, small } = d;
    if (d.step === 'gather' && big.state === 'work' && small.state === 'work') { d.step = 'up'; d.t = 0; }
    if (d.step === 'up') { small.lift = Math.min(1, d.t / 0.8) * 34; small.x += (big.x + 0.1 - small.x) * 0.15; small.y += (big.y - 0.14 - small.y) * 0.15; if (d.t > 0.8) { d.step = 'hold'; d.t = 0; say(small, V(small, 'lifted', {})); } }
    if (d.step === 'hold' && d.t > 1.4) { d.step = 'down'; d.t = 0; const [x, y] = P(-0.5, 1.7, 1.8); sparkle(x, y, 10); }
    if (d.step === 'down') { small.lift = Math.max(0, 1 - d.t / 0.6) * 34; if (d.t > 0.6) { big.busy = small.busy = null; small.lift = 0;
      say(small, V(small, 'highfive', { name: big.cfg.name })); const other = d.owner === big ? small : big; other.target = other.prev || [other.x, other.y]; other.state = other.cur ? 'walk' : 'idle'; } }
  }
}

// ---------- physics: everyone and everything has mass ----------
const G = 9.0, FRICTION = 4.0;
function inSolid(x, y, pad, room) { for (const [x1, y1, x2, y2] of ROOMS[room].solids) if (x > x1 - pad && x < x2 + pad && y > y1 - pad && y < y2 + pad) return [x1 - pad, y1 - pad, x2 + pad, y2 + pad]; return null; }
function collideWorld(b, room, bounce = 0.35) {
  if (b.x < -1.75 + b.r) { b.x = -1.75 + b.r; b.vx = Math.abs(b.vx) * bounce; } if (b.x > 1.8 - b.r) { b.x = 1.8 - b.r; b.vx = -Math.abs(b.vx) * bounce; }
  if (b.y < -1.85 + b.r) { b.y = -1.85 + b.r; b.vy = Math.abs(b.vy) * bounce; } if (b.y > 1.75 - b.r) { b.y = 1.75 - b.r; b.vy = -Math.abs(b.vy) * bounce; }
  if (b.z > 0.3) return;
  const s = inSolid(b.x, b.y, b.r * 0.6, room); if (!s) return;
  const [x1, y1, x2, y2] = s, d = [b.x - x1, x2 - b.x, b.y - y1, y2 - b.y], m = Math.min(...d);
  if (m === d[0]) { b.x = x1; b.vx = -Math.abs(b.vx) * bounce; } else if (m === d[1]) { b.x = x2; b.vx = Math.abs(b.vx) * bounce; }
  else if (m === d[2]) { b.y = y1; b.vy = -Math.abs(b.vy) * bounce; } else { b.y = y2; b.vy = Math.abs(b.vy) * bounce; }
}
const bodies = room => [...agents.filter(a => a.room === room && !['sleep', 'held', 'wake'].includes(a.state) && !a.lift), ...ROOMS[room].props];
function collidePairs(room, now) {
  const bs = bodies(room);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001, min = a.r + b.r;
    if (d >= min) continue;
    const nx = dx / d, ny = dy / d, overlap = min - d, ma = a.mass, mb = b.mass, sum = ma + mb;
    a.x -= nx * overlap * mb / sum; a.y -= ny * overlap * mb / sum; b.x += nx * overlap * ma / sum; b.y += ny * overlap * ma / sum;
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) { const imp = -1.5 * rv / (1 / ma + 1 / mb); a.vx -= imp * nx / ma; a.vy -= imp * ny / ma; b.vx += imp * nx / mb; b.vy += imp * ny / mb;
      for (const [p, q] of [[a, b], [b, a]]) if (p.cfg && -rv > 0.6 && now - (p.bumpT || 0) > 4000 && !p.busy) { p.bumpT = now; p.wobble = 1; say(p, V(p, 'bumped', { name: q.cfg ? q.cfg.name : 'that' })); } }
  }
}
function stepBody(b, dt, room) {
  b.vz -= G * dt; b.z += b.vz * dt; if (b.z < 0) { b.z = 0; b.vz = b.vz < -1.2 ? -b.vz * 0.35 : 0; }
  const k = Math.exp(-FRICTION * dt * (b.z > 0 ? 0.2 : 1)); b.vx *= k; b.vy *= k;
  b.x += b.vx * dt; b.y += b.vy * dt; collideWorld(b, room);
}

// ---------- poke, drag-to-lift, shake ----------
let held = null, downAt = null;
function addHitbox(a) {
  const hb = el('rect', { x: -22, y: -110, width: 44, height: 110, fill: 'transparent' }, a.v.root);
  hb.addEventListener('pointerdown', e => { e.preventDefault(); downAt = { a, x: e.clientX, y: e.clientY, t: performance.now() }; });
}
function toSvg(e) { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 480, (e.clientY - r.top) / r.height * 480]; }
addEventListener('pointermove', e => {
  if (!downAt) return;
  if (!held && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) { held = downAt.a; held.prevState = held.state; held.state = 'held'; if (held.busy) { held.busy = null; } say(held, V(held, 'grabbed', {})); }
  if (held) { const [sx, sy] = toSvg(e); const [fx2, fy2] = floorAt(sx, sy + 70);
    held.vx = (fx2 - held.x) * 10; held.vy = (fy2 - held.y) * 10; held.x = clamp(fx2, -1.6, 1.6); held.y = clamp(fy2, -1.7, 1.6); held.z = 1.0; }
});
addEventListener('pointerup', () => {
  if (!downAt) return;
  const a = downAt.a;
  if (held) { held.state = 'falling'; held.vz = 0; held = null; } else if (performance.now() - downAt.t < 450) poke(a);
  downAt = null;
});
function poke(a) {
  if (a.state === 'sleep') { a.state = 'wake'; a.t = 0; say(a, V(a, 'poked', {})); return; }
  a.vz = 2.4; a.wobble = 1; a.spin = 1; say(a, V(a, 'poked', {}));
  setTimeout(() => { const t = current(a); say(a, t ? V(a, 'nudge', { chore: t.name.toLowerCase(), when: 'now' }) : V(a, 'greet', { name: 'you' })); }, 1700);
}
function shake(power = 1) {
  for (const room of Object.keys(ROOMS)) for (const b of bodies(room)) { b.vx += (Math.random() - 0.5) * 3 * power; b.vy += (Math.random() - 0.5) * 3 * power; b.vz = 1 + Math.random() * 2 * power; if (b.cfg) b.wobble = 1; }
  agents.filter(a => a.room === view && a.state !== 'sleep').forEach((a, i) => setTimeout(() => {
    say(a, V(a, 'shaken', {})); setTimeout(() => { const t = current(a); if (t) say(a, V(a, 'nudge', { chore: t.name.toLowerCase(), when: 'now' })); }, 1800); }, i * 450));
}
let lastShake = 0;
function onMotion(e) { const g = e.accelerationIncludingGravity || e.acceleration; if (!g) return; const m = Math.hypot(g.x || 0, g.y || 0, g.z || 0);
  if (m > 22 && performance.now() - lastShake > 2500) { lastShake = performance.now(); shake(Math.min(2, (m - 18) / 10)); } }
document.getElementById('shakeBtn').onclick = async () => {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') { try { if (await DeviceMotionEvent.requestPermission() === 'granted') addEventListener('devicemotion', onMotion); } catch {} }
  shake(1);
};
if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function') addEventListener('devicemotion', onMotion);

// ---------- main loop ----------
let last = performance.now(), lastPanel = 0;
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const a of agents) {
    a.phase += dt * 6; a.t += dt; const t = current(a), f = fatigue(a), speed = 0.9 * (0.75 + a.cfg.size * 0.25) * (1 - 0.6 * f);
    if (a.state === 'sleep') a.z = ROOMS.bedroom.bed[2];
    if (a.state === 'wake') { a.z = ROOMS.bedroom.bed[2]; if (a.t > 0.8 && !a.yawned) { a.yawned = 1; say(a, V(a, 'wakeup', {})); } if (a.t > 2.6) { a.state = 'hop'; a.vz = 2.8; a.vx = -1.3; a.vy = -1.0; a.t = 0; } }
    if (a.state === 'out') { if (now > a.outUntil) { a.room = 'kitchen'; [a.x, a.y] = ROOMS.kitchen.door; a.state = 'walk'; a.target = [0.55, -0.6]; a.bestD = 9; a.refreshed = clockNow();
        a.dest = { room: 'kitchen', spot: [0.55, -0.6], then: 'home' }; say(a, V(a, 'home', {})); renderPeople(); } pose(a, now, 0); continue; }
    if (a.state === 'idle' && a.t > 6 && !a.cur && a.plan.length === 0) { a.t = 0; goBed(a); }
    if (a.state === 'hop' && a.z === 0 && a.t > 0.4) { a.state = 'stretch'; a.t = 0; }
    if (a.state === 'stretch' && a.t > 1.6) startNext(a);
    if (a.state === 'walk' || a.state === 'leaving') {
      const dx = a.target[0] - a.x, dy = a.target[1] - a.y, dist = Math.hypot(dx, dy);
      if (dist > 0.05) { a.vx += ((dx / dist) * speed - a.vx) * Math.min(1, dt * 8); a.vy += ((dy / dist) * speed - a.vy) * Math.min(1, dt * 8); }
      if (dist < a.bestD - 0.01) { a.bestD = dist; a.stuckT = 0; } else a.stuckT = (a.stuckT || 0) + dt;
      if (dist < Math.max(0.08, a.r * 0.6) || a.stuckT > 1.6) {
        a.bestD = 9; a.stuckT = 0;
        if (a.state === 'leaving') { const ct = current(a), d = ct ? { room: ct.room, spot: ct.spot } : a.dest;
          if (!d || d.then === 'out') { a.state = 'out'; a.room = 'outside'; a.outUntil = now + OUT_MS; a.vx = a.vy = 0; renderPeople(); }
          else { a.room = d.room; [a.x, a.y] = ROOMS[a.room].door; a.state = 'walk'; a.target = [...d.spot];
            if (d.room !== view && !agents.some(o => o.room === view && (o.cur || o.dest) && o !== a)) { view = d.room; drawRoom(); } } }
        else if (!t && a.dest) arrive(a, a.dest);
        else { a.state = 'work'; a.t = 0; if (t && !a.busy) { say(a, V(a, 'working', { chore: t.name.toLowerCase() })); if (t.duo) tryDuo(a, t); } }
      }
    } else if (a.state === 'work' && t) {
      if (t.roam && !a.busy) { const tx = t.spot[0] + Math.sin(a.t * 0.9) * 0.45, ty = t.spot[1] + Math.sin(a.t * 0.45) * 0.35; a.vx += (tx - a.x) * dt * 6; a.vy += (ty - a.y) * dt * 6; }
      // never finishes on its own; overdue → tired, and a reminder 8 hours past the planned finish
      if (f > 0.25 && Math.random() < dt * 0.04) say(a, V(a, 'tired', { chore: t.name.toLowerCase() }));
      if (!a.warned8h && clockNow() - a.plannedEnd >= 8 * 3600e3) { a.warned8h = true; toast(a, V(a, 'recover', { chore: t.name.toLowerCase(), left: 'this one chore' }, false) + ' (8 hours past the plan)'); }
    } else if (a.state === 'cheer' && a.t > 1.4) startNext(a);
    if (!['held', 'sleep', 'wake', 'out'].includes(a.state) && ROOMS[a.room] && !a.lift) stepBody(a, dt, a.room);
    if (a.state === 'falling' && a.z === 0 && Math.abs(a.vz) < 0.01) { a.wobble = 1; say(a, V(a, 'dropped', {})); a.state = 'stretch'; a.t = 0;
      setTimeout(() => { const ct = current(a); if (ct && a.state === 'stretch') { say(a, V(a, 'nudge', { chore: ct.name.toLowerCase(), when: 'now' })); a.state = ct.room === a.room ? 'walk' : 'leaving'; a.target = ct.room === a.room ? [...ct.spot] : [...ROOMS[a.room].door]; a.bestD = 9; } }, 1500); }
    if (a.wobble) a.wobble = Math.max(0, a.wobble - dt * 1.6); if (a.spin) a.spin = Math.max(0, a.spin - dt * 1.8);
    pose(a, now, f);
  }
  for (const room of Object.keys(ROOMS)) { ROOMS[room].props.forEach(p => stepBody(p, dt, room)); collidePairs(room, now); }
  ROOMS[view].props.forEach(drawProp);
  for (const d of new Set(agents.map(a => a.busy).filter(Boolean))) runDuo(d, dt);
  [...agents].filter(a => a.room === view).sort((m, n) => P(m.x, m.y)[1] - P(n.x, n.y)[1]).forEach(a => actors.appendChild(a.v.root));
  agents.forEach(a => a.v.root.setAttribute('display', a.room === view ? 'inline' : 'none'));
  glints(now);
  if (now - lastPanel > 1000) { lastPanel = now; renderPeopleTimes(); }
  requestAnimationFrame(tick);
}
function drawProp(p) { const g = p.g; if (!g) return; while (g.firstChild) g.removeChild(g.firstChild);
  const [sx, sy] = P(p.x, p.y, 0), [, hy] = P(p.x, p.y, p.z);
  el('ellipse', { cx: sx, cy: sy, rx: p.r * 60, ry: p.r * 22, fill: 'rgba(0,0,0,.18)' }, g);
  if (p.kind === 'ball') el('circle', { cx: sx, cy: hy - p.r * 60, r: p.r * 60, fill: p.color, stroke: '#2b2b2b', 'stroke-width': 1.2 }, g);
  else el('rect', { x: sx - p.r * 60, y: hy - p.r * 110, width: p.r * 120, height: p.r * 90, rx: 4, fill: p.color, stroke: '#2b2b2b', 'stroke-width': 1.2 }, g); }
function pose(a, now, f) {
  const p = a.v.parts, t = current(a);
  const act = a.state === 'walk' || a.state === 'leaving' ? 'walk' : a.state === 'work' ? (t ? t.act : 'idle') : a.state;
  const tempo = 1 - 0.55 * f, sw = Math.sin(a.phase * (act === 'walk' ? 1.6 : 2.4) * tempo);
  p.legL.setAttribute('transform', act === 'walk' ? `rotate(${sw * 22} -6 -20)` : a.state === 'held' ? `rotate(${Math.sin(now / 150) * 25} -6 -20)` : '');
  p.legR.setAttribute('transform', act === 'walk' ? `rotate(${-sw * 22} 6 -20)` : a.state === 'held' ? `rotate(${-Math.sin(now / 150) * 25} 6 -20)` : '');
  let aL = 10, aR = -10;
  if (act === 'walk') { aL = sw * 25; aR = -sw * 25; } if (act === 'scrub') { aR = -60 + sw * 25 * tempo; aL = 15; }
  if (act === 'sweep') { aR = -20 + sw * 30; aL = -10 + sw * 30; } if (act === 'carry') { aR = -15; aL = 15; } if (act === 'reach') { aR = -150 + sw * 8; aL = -20; }
  if (['cheer', 'stretch', 'held', 'falling'].includes(a.state)) { aL = 150 + sw * 15; aR = -150 - sw * 15; }
  if (a.busy?.kind === 'lift' && a.busy.big === a && a.busy.step !== 'gather') { aL = 160; aR = -160; }
  if (f > 0) { aL = aL * (1 - f) + 20 * f; aR = aR * (1 - f * 0.5) - 5 * f; }                       // arms drag when worn out
  p.armL.setAttribute('transform', `translate(-14 -42) rotate(${aL})`); p.armR.setAttribute('transform', `translate(14 -42) rotate(${aR})`);
  const sleepy = a.state === 'sleep' ? 0.1 : Math.sin(now / 900 + a.id * 2) > 0.985 ? 0.2 : 1 - 0.7 * f;
  p.eyeL.setAttribute('ry', 2.1 * sleepy); p.eyeR.setAttribute('ry', 2.1 * sleepy);
  p.mouth.setAttribute('d', f > 0.4 ? 'M-3.5 -50.5 Q0 -52.5 3.5 -50.5' : a.state === 'held' || a.spin > 0 ? 'M-2.5 -51 Q0 -47 2.5 -51 Q0 -49.5 -2.5 -51' : 'M-3.5 -52 Q0 -49 3.5 -52');
  a.cm.setAttribute('values', (1 - 0.75 * f).toFixed(2));                                             // colour drains with tiredness
  const fresh = clamp(1 - (clockNow() - (a.refreshed || 0)) / 6000, 0, 1);
  const bob = act === 'walk' ? Math.abs(sw) * 2 : a.state === 'cheer' ? Math.abs(sw) * 6 : Math.sin(a.phase * 0.5) * (1 - f);
  const slump = f * 7, lean = f * 9 + Math.sin(now / 90) * 8 * a.wobble;
  const lying = a.state === 'sleep' ? -78 : a.state === 'wake' ? -78 + Math.min(1, a.t / 1.2) * 60 : 0;
  const [sx, sy] = P(a.x, a.y), [, zy] = P(a.x, a.y, a.z);
  a.v.root.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
  a.v.body.setAttribute('transform', `translate(0 ${(zy - sy - bob - a.lift + slump).toFixed(1)}) rotate(${(lying + lean * a.facing + a.spin * 360).toFixed(1)}) scale(${a.cfg.size * SCALE * a.facing} ${a.cfg.size * SCALE * (1 - 0.06 * f)})`);
  a.v.parts.bubble.setAttribute('transform', `translate(0 ${(zy - sy - a.lift).toFixed(1)})`);
  if (!a.fxG) a.fxG = el('g', {}, a.v.root); while (a.fxG.firstChild) a.fxG.removeChild(a.fxG.firstChild);
  const top = (zy - sy) - 92 * a.cfg.size * SCALE;
  if (f > 0.3) el('path', { d: `M14 ${top + 18 + (now / 30) % 14} q3 5 0 8 q-3 -3 0 -8`, fill: '#7cb7e8' }, a.fxG);          // sweat
  if (fresh > 0) el('text', { x: 16, y: top + 6, 'font-size': 12, opacity: fresh.toFixed(2) }, a.fxG).textContent = '✨';     // refreshed
  if (a.state === 'sleep') el('text', { x: 18, y: top + 20 - (now / 40) % 16, 'font-size': 12, 'font-weight': 800, fill: '#5b4a9e' }, a.fxG).textContent = 'z';
  if (a.wobble > 0.5 && a.state !== 'sleep') el('text', { x: -24, y: top + 10, 'font-size': 12 }, a.fxG).textContent = '💫';
}

// ---------- notifications from your avatar ----------
function toast(a, msg) {
  const t = document.getElementById('toast'); t.innerHTML = '';
  t.appendChild(Avatar.svg(a.cfg, a.cfg.name));
  const p = document.createElement('div'); const b = document.createElement('b'); b.textContent = a.cfg.name; p.appendChild(b); p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(msg)); t.appendChild(p);
  t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 5200);
}
let nudgeT = 30;
setInterval(() => { if (--nudgeT > 0) return; nudgeT = 40;        // reminders are about the task you're on
  const a = agents.find(x => x.cur && x.room === view && x.state === 'work'); if (!a) return; const t = current(a);
  const left = Math.round((a.plannedEnd - clockNow()) / 60000);
  toast(a, V(a, 'nudge', { chore: t.name.toLowerCase(), when: left > 0 ? `the next ${left} minutes` : 'now' }, false)); }, 1000);

// ---------- panel: one task each, switch, submit photo ----------
function fmtLeft(a) { if (!a.cur) return ''; const m = Math.round((a.plannedEnd - clockNow()) / 60000);
  return m >= 0 ? `${m} min left on the plan` : `${Math.floor(-m / 60)}h ${(-m) % 60}m past the plan`; }
function renderPeople() {
  const box = document.getElementById('people');
  box.innerHTML = agents.map(a => { const t = current(a); const options = Object.entries(TASK).filter(([k]) => !doneTasks.has(k));
    return `<div class="person"><b>${a.cfg.name}</b> <span class="sm">· ${a.cfg.personality}</span>
    <div class="sm" data-left="${a.id}">${statusLine(a)}</div>
    <label class="sm" style="display:block;margin-top:8px">Switch task (one at a time) <select data-sw="${a.id}"><option value="">—</option>${options.map(([k, x]) => `<option value="${k}" ${k === a.cur ? 'selected' : ''}>${x.name} · ${x.room}</option>`).join('')}</select></label>
    ${addonRow(a)}
    ${t ? `<div class="row stars"><span class="sm">Photo submitted, scored:</span>${[1, 2, 3, 4, 5].map(n => `<button class="btn alt" data-ph="${a.id}" data-s="${n}" aria-label="Submit photo, ${n} stars">${n}★</button>`).join('')}</div>` : ''}</div>`; }).join('');
  box.querySelectorAll('[data-sw]').forEach(s => s.onchange = () => { const a = agents.find(x => x.id == s.dataset.sw); if (s.value && s.value !== a.cur) { a.busy = null; startTask(a, s.value); } });
  box.querySelectorAll('[data-ao]').forEach(b => b.onclick = () => logAddon(agents.find(x => x.id == b.dataset.ao), +b.dataset.i));
  box.querySelectorAll('[data-rw]').forEach(b => b.onclick = () => rewardAddon(agents.find(x => x.id == b.dataset.rw), +b.dataset.i, 100));
  box.querySelectorAll('[data-own]').forEach(f => f.onsubmit = e => { e.preventDefault(); addOwnAddon(agents.find(x => x.id == f.dataset.own), f.elements[0].value); });
  box.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => submitPhoto(agents.find(x => x.id == b.dataset.ph), +b.dataset.s));
}
function statusLine(a) { const t = current(a);
  if (t) return `Doing: <b>${t.name}</b> (${t.room}) · ${fmtLeft(a)}`;
  if (a.state === 'out') return `Chores done · out of the house, back in ${Math.max(0, Math.ceil((a.outUntil - performance.now()) / 1000))}s`;
  if (a.state === 'sleep') return a.plan.length ? 'Asleep. Tap them to wake them up.' : 'Chores done · asleep';
  if (a.dest?.then === 'bed') return 'Chores done · heading to bed';
  return a.plan.length ? 'Getting ready' : 'Chores done · home'; }
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function addonRow(a) {
  const chip = (ad, i) => { const held = ad.logs.filter(l => l.status === 'held').length, rel = ad.logs.filter(l => l.status === 'released').length, own = ad.logs.filter(l => l.status === 'logged').length;
    const tag = ad.v ? `$${(ad.v / 100).toFixed(2)} · ${ad.by === 'app' ? 'app' : 'parent'}` : 'yours';
    const state = held ? ` · 🔒 ${held} waiting for chores` : rel ? ` · ✅ ${rel} paid` : own ? ` · ${own} logged, shared with parents` : '';
    return `<button class="btn x" data-ao="${a.id}" data-i="${i}" aria-label="Log ${esc(ad.n)}">${ad.e} ${esc(ad.n)} <span class="sm">(${tag}${state})</span></button>`
      + (own ? `<button class="btn alt" data-rw="${a.id}" data-i="${i}" aria-label="Parent: reward ${esc(ad.n)} with $1">Reward $1 (parent)</button>` : ''); };
  return `<div class="row"><span class="sm"><b>Add-ons</b> · bonuses $${(a.bonus / 100).toFixed(2)}</span></div><div class="row">${a.addons.map(chip).join('')}</div>
    <form class="row" data-own="${a.id}"><input maxlength="60" placeholder="Add your own (e.g. eat dinner together)" aria-label="New add-on for ${esc(a.cfg.name)}" style="flex:1;min-height:40px;border-radius:10px;border:1px solid #c9bfb3;padding:0 10px;font:inherit"><button class="btn go">Add</button></form>`; }
function renderPeopleTimes() { agents.forEach(a => { const n = document.querySelector(`[data-left="${a.id}"]`); if (n) n.innerHTML = statusLine(a); }); }

// ---------- controls ----------
document.querySelectorAll('[data-room]').forEach(b => b.onclick = () => { view = b.dataset.room; drawRoom(); });
document.getElementById('ff').oninput = e => { offsetMs = +e.target.value * 3600e3; document.getElementById('ffv').textContent = e.target.value + 'h'; };
document.getElementById('push').onclick = () => agents.forEach(a => releaseAddons(a, true)) || renderPeople();
document.getElementById('reset').onclick = () => { for (const k in level) delete level[k]; doneTasks.clear(); refreshColors(); renderPeople(); };
(function picker() { const box = document.getElementById('picker');
  PRESETS.slice(2).forEach(cfg => { const b = document.createElement('button'); b.className = 'pick'; b.setAttribute('aria-label', 'Add ' + cfg.name);
    b.appendChild(Avatar.svg(cfg, cfg.name)); b.appendChild(document.createTextNode(cfg.name)); b.onclick = () => addAgent({ ...cfg }); box.appendChild(b); }); })();

drawRoom();
addAgent({ ...PRESETS[0] }); addAgent({ ...PRESETS[1] });
setTimeout(() => { const a = agents[0]; if (a.state === 'sleep') { a.state = 'wake'; a.t = 0; } }, 2500);   // Bear Cub's alarm goes off
requestAnimationFrame(tick);
