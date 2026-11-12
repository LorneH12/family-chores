// Room scene prototype: cartoon avatars doing chores in the toy kitchen.
// World units match the Blender room (art/rooms_blender.py); P() projects them onto the 480×480 render (angle 05).
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const rnd = a => a[Math.floor(Math.random() * a.length)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- projection (orthographic camera from the Blender scene) ----------
const CAM = [9.5, -9.5, 8.9], PX = 480 / 6.4, RIGHT = [0.7071, 0.7071, 0], UP = [-0.3747, 0.3747, 0.848], TH = -2 * Math.PI / 180, ROOTZ = -0.75;
function P(x, y, z = 0) {
  const c = Math.cos(TH), s = Math.sin(TH), X = x * c - y * s, Y = x * s + y * c, Z = z + ROOTZ;
  const d = [X - CAM[0], Y - CAM[1], Z - CAM[2]];
  return [240 + (d[0] * RIGHT[0] + d[1] * RIGHT[1]) * PX, 240 - (d[0] * UP[0] + d[1] * UP[1] + d[2] * UP[2]) * PX];
}

// ---------- the room ----------
el('image', { href: 'rooms/scene-kitchen.webp', x: 0, y: 0, width: 480, height: 480 }, svg);
const props = el('g', {}, svg), messLayer = el('g', {}, svg), actors = el('g', {}, svg), fx = el('g', {}, svg);
// cupboard on the back wall and a bin by the door
(() => { const [a, b, c, d] = [P(-0.9, 1.78, 1.55), P(-0.1, 1.78, 1.55), P(-0.1, 1.78, 2.05), P(-0.9, 1.78, 2.05)];
  el('polygon', { points: [a, b, c, d].map(p => p.join(',')).join(' '), fill: '#c98e5a', stroke: '#8a5a33', 'stroke-width': 1.5 }, props);
  const m = P(-0.5, 1.78, 1.8); el('circle', { cx: m[0] + 4, cy: m[1], r: 2, fill: '#ffc857' }, props); })();
const BIN = [1.75, -1.55];
(() => { const [x, y] = P(...BIN); el('rect', { x: x - 11, y: y - 26, width: 22, height: 26, rx: 4, fill: '#2f6f4f' }, props); el('rect', { x: x - 13, y: y - 30, width: 26, height: 6, rx: 3, fill: '#24573e' }, props); })();

const TASKS = [
  { id: 'dishes', name: 'Wash the dishes', spot: [0.25, 0.8], act: 'scrub', dur: 7 },
  { id: 'counters', name: 'Wipe counters and stovetop', spot: [1.05, 0.8], act: 'scrub', dur: 6 },
  { id: 'island', name: 'Wipe the island', spot: [-0.15, -0.9], act: 'scrub', dur: 6 },
  { id: 'floor', name: 'Sweep and mop the floor', spot: [0.55, -0.35], act: 'sweep', dur: 8, roam: true },
  { id: 'fridge', name: 'Clean the fridge front', spot: [-0.75, 0.55], act: 'scrub', dur: 6 },
  { id: 'trash', name: 'Empty the trash', spot: [1.25, -1.25], act: 'carry', dur: 5, duo: 'alleyoop' },
  { id: 'putaway', name: 'Put the dishes away', spot: [-0.5, 0.78], act: 'reach', dur: 6, duo: 'lift' },
];
const T = Object.fromEntries(TASKS.map(t => [t.id, t]));

// mess for each task (disappears as it's done → the room gets noticeably cleaner)
const MESS = {};
function mess(id, draw) { const g = el('g', { 'data-task': id }, messLayer); draw(g); MESS[id] = g; }
mess('dishes', g => { const [x, y] = P(0.2, 1.45, 1.12); for (let i = 0; i < 4; i++) el('ellipse', { cx: x - 4 + i * 2, cy: y - i * 4, rx: 11, ry: 4, fill: i % 2 ? '#e8e2d6' : '#fff', stroke: '#b8ad9c' }, g);
  el('circle', { cx: x + 10, cy: y - 14, r: 3, fill: '#c0662f' }, g); });
mess('counters', g => { const [x, y] = P(1.07, 1.35, 1.12); [[0, 0], [8, 3], [-6, 4], [4, -4]].forEach(([dx, dy]) => el('ellipse', { cx: x + dx, cy: y + dy, rx: 4, ry: 2, fill: '#8a4b1f', opacity: .8 }, g)); });
mess('island', g => { const [x, y] = P(-0.9, -0.9, 0.98); for (let i = 0; i < 14; i++) el('circle', { cx: x + (Math.random() - .5) * 40, cy: y + (Math.random() - .5) * 14, r: 1.6, fill: '#a0662f' }, g); });
mess('floor', g => { [[0.6, 0.2], [1.1, -0.6], [0.2, -0.6], [0.3, 0.6]].forEach(([a, b]) => { const [x, y] = P(a, b); el('ellipse', { cx: x, cy: y, rx: 16, ry: 6, fill: '#6b4a2a', opacity: .35 }, g); }); });
mess('fridge', g => { const [x, y] = P(-1.04, 1.4, 1.1); [[0, 0], [4, 12], [-3, 22]].forEach(([dx, dy]) => el('ellipse', { cx: x + dx, cy: y + dy, rx: 3, ry: 6, fill: '#7a6a58', opacity: .6 }, g)); });
mess('trash', g => { const [x, y] = P(...BIN); el('circle', { cx: x - 4, cy: y - 33, r: 8, fill: '#3b3b3b' }, g); el('circle', { cx: x + 6, cy: y - 36, r: 6, fill: '#555' }, g); el('rect', { x: x + 10, y: y - 8, width: 9, height: 7, fill: '#e5534b', rx: 2 }, g); });
mess('putaway', g => { const [x, y] = P(-0.4, 1.45, 1.12); for (let i = 0; i < 5; i++) el('rect', { x: x - 10 + i * 5, y: y - 14, width: 3, height: 13, rx: 1.5, fill: '#fff', stroke: '#b8ad9c' }, g); el('rect', { x: x - 13, y: y - 2, width: 30, height: 3, fill: '#9aa3ab' }, g); });
const done = new Set();
function updateClean() { const pct = Math.round(done.size / TASKS.length * 100); document.getElementById('cbar').style.width = pct + '%'; document.getElementById('cpct').textContent = pct + '%'; }

// ---------- characters ----------
const SKIN = ['#4A2C17', '#5C3A21', '#6B4226', '#7A4A2A', '#8D5524', '#A0662F'];
const PRESETS = [
  { name: 'Bear Cub', size: 0.72, skin: '#8D5524', hair: 'puffs', outfit: 'bear', personality: 'goofy', tasks: ['island', 'putaway', 'dishes'] },
  { name: 'Big Mike', size: 1.12, skin: '#4A2C17', hair: 'fade', outfit: 'gym', personality: 'hype', tasks: ['trash', 'floor', 'counters'] },
  { name: 'Princess Zee', size: 0.95, skin: '#A0662F', hair: 'puffs', outfit: 'cape', personality: 'dramatic', tasks: ['fridge', 'dishes'] },
  { name: 'DJ Chill', size: 1.0, skin: '#6B4226', hair: 'locs', outfit: 'hoodie', personality: 'chill', tasks: ['floor', 'trash'] },
  { name: 'Auntie Boss', size: 1.05, skin: '#7A4A2A', hair: 'wrap', outfit: 'apron', personality: 'bossy', tasks: ['counters', 'putaway'] },
  { name: 'Pajama Pops', size: 1.1, skin: '#5C3A21', hair: 'afro', outfit: 'robe', personality: 'cheerful', tasks: ['dishes', 'island'] },
];
const LINES = {
  goofy: { work: ['Rawr! Crumbs fear me!', 'Bear-y clean!', 'Is this a snack? No? Okay.'], done: ['Paw-some!', 'Ta-daa!'], hi: ['Beep beep, bear coming through!', 'Bear hug? Later!'], nudge: ['Psst… the dishes miss you 🐻', 'Rawr! Chore time, then fun time!'] },
  hype: { work: ["LET'S GOOO!", 'Feel the burn, floor!', 'One more rep!'], done: ['PR! Personal record!', 'Crushed it!'], hi: ['Spot me, champ!', 'Lookin strong!'], nudge: ['Warm-up time! Your room needs a champion 💪', "Reps first, rest later! Let's go!"] },
  dramatic: { work: ['A princess… scrubbing?! Fine.', 'The sparkle shall return!'], done: ['Behold: perfection.', '*takes a bow*'], hi: ['Make way, make way!', 'Your highness 👑'], nudge: ['The kingdom needs you. Also the bathroom.', 'Destiny calls… and so do the dishes.'] },
  chill: { work: ['Smooth.', 'No rush, no fuss.'], done: ['Easy.', 'Clean and calm.'], hi: ['Sup.', '✌️'], nudge: ['Five chill minutes = one clean room. Easy.', 'Low-key, the counters could use you.'] },
  bossy: { work: ['Corners count, baby!', 'That is how it is DONE.'], done: ['Inspected and approved!', 'Mm-hmm. Beautiful.'], hi: ['Watch your step, sugar!', 'Excuse me, coming through!'], nudge: ["Baby, those dishes won't wash themselves.", 'Let me see that sparkle today!'] },
  cheerful: { work: ['Teamwork!', 'Look at that shine!'], done: ['Woo-hoo!', 'High five!'], hi: ['Hey hey!', 'After you!'], nudge: ['Good morning! Ready to make it shine? ☀️', "You've got this! One task at a time."] },
  shy: { work: ['…almost…', 'Quiet sparkle.'], done: ['…done!', 'Oh! It worked.'], hi: ['Oh! Hi.', 'Sorry, um, excuse me.'], nudge: ['Um… maybe a quick chore? 🙂', "I'll be right there with you."] },
};

function hairSVG(g, style, s) {
  const c = '#1b120c';
  if (style === 'puffs') { el('circle', { cx: -11, cy: -68, r: 7, fill: c }, g); el('circle', { cx: 11, cy: -68, r: 7, fill: c }, g); el('path', { d: 'M-13 -58 Q0 -72 13 -58 Q0 -64 -13 -58', fill: c }, g); }
  else if (style === 'fade') el('path', { d: 'M-13 -57 Q0 -73 13 -57 L12 -60 Q0 -70 -12 -60 Z', fill: c }, g);
  else if (style === 'locs') { el('path', { d: 'M-14 -56 Q0 -76 14 -56 Q0 -66 -14 -56', fill: c }, g); for (let i = -12; i <= 12; i += 6) el('rect', { x: i - 2, y: -60, width: 4, height: 20, rx: 2, fill: c }, g); }
  else if (style === 'braids') { el('path', { d: 'M-13 -57 Q0 -74 13 -57 Q0 -64 -13 -57', fill: c }, g); el('rect', { x: -15, y: -58, width: 4, height: 24, rx: 2, fill: c }, g); el('rect', { x: 11, y: -58, width: 4, height: 24, rx: 2, fill: c }, g); }
  else if (style === 'wrap') { el('path', { d: 'M-15 -56 Q0 -82 15 -56 Q0 -62 -15 -56', fill: '#e5534b' }, g); el('circle', { cx: 9, cy: -73, r: 6, fill: '#ffc857' }, g); }
}
function makeCharacter(cfg) {
  const root = el('g', {}, actors), body = el('g', {}, root);
  const s = cfg.size, k = s, skin = cfg.skin, o = cfg.outfit;
  const fur = '#7a4a24', furLight = '#c9965e';
  const top = { bear: fur, gym: '#2f6f4f', cape: '#f4a6c1', hoodie: '#7cb7e8', apron: '#a98be6', robe: '#4f7fd1' }[o] || '#ff8a65';
  const legC = o === 'bear' ? fur : o === 'gym' ? '#2e3a59' : o === 'robe' ? skin : '#2e3a59';
  const parts = {};
  el('ellipse', { cx: 0, cy: 0, rx: 14, ry: 4, fill: 'rgba(0,0,0,.18)' }, root);       // shadow
  body.setAttribute('transform', `scale(${k})`);
  parts.legL = el('g', {}, body); parts.legR = el('g', {}, body);
  [[parts.legL, -6], [parts.legR, 6]].forEach(([g, x]) => { el('rect', { x: x - 3.5, y: -20, width: 7, height: 18, rx: 3, fill: legC }, g);
    el('ellipse', { cx: x + 1, cy: -2, rx: 5.5, ry: 3.2, fill: o === 'robe' ? '#ff8ab5' : o === 'bear' ? '#5a3418' : '#fff' }, g); });
  if (o === 'cape') el('path', { d: 'M-14 -44 L-20 -8 L20 -8 L14 -44 Z', fill: '#e5534b' }, body);
  parts.torso = el('rect', { x: o === 'gym' ? -15 : -13, y: -46, width: o === 'gym' ? 30 : 26, height: 30, rx: 9, fill: top }, body);
  if (o === 'bear') el('ellipse', { cx: 0, cy: -30, rx: 8, ry: 10, fill: furLight }, body);
  if (o === 'gym') { el('rect', { x: -5, y: -46, width: 10, height: 10, rx: 3, fill: skin }, body); el('rect', { x: -15, y: -20, width: 30, height: 8, rx: 3, fill: '#2e3a59' }, body); }
  if (o === 'cape') el('path', { d: 'M-15 -22 L15 -22 L22 -12 L-22 -12 Z', fill: '#ffd1e3', stroke: '#f4a6c1' }, body);
  if (o === 'apron') el('rect', { x: -9, y: -40, width: 18, height: 26, rx: 4, fill: '#fff' }, body);
  if (o === 'robe') el('path', { d: 'M0 -46 L-6 -16 M0 -46 L6 -16', stroke: '#2f4f9a', 'stroke-width': 2 }, body);
  if (o === 'hoodie') el('rect', { x: -7, y: -30, width: 14, height: 8, rx: 3, fill: '#5d98cf' }, body);
  const armW = o === 'gym' ? 9 : 6.5, armC = o === 'gym' ? skin : o === 'bear' ? fur : top, hand = o === 'apron' ? '#ffc857' : o === 'bear' ? '#5a3418' : skin;
  parts.armL = el('g', { transform: 'translate(-14 -42)' }, body); parts.armR = el('g', { transform: 'translate(14 -42)' }, body);
  [parts.armL, parts.armR].forEach(g => { el('rect', { x: -armW / 2, y: 0, width: armW, height: 20, rx: armW / 2, fill: armC }, g); el('circle', { cx: 0, cy: 21, r: o === 'gym' ? 5 : 4, fill: hand }, g); });
  parts.tool = el('g', {}, parts.armR);
  parts.head = el('g', { transform: 'translate(0 0)' }, body);
  if (o === 'bear') { el('circle', { cx: -12, cy: -70, r: 6, fill: fur }, parts.head); el('circle', { cx: 12, cy: -70, r: 6, fill: fur }, parts.head); el('circle', { cx: 0, cy: -57, r: 17, fill: fur }, parts.head); }
  if (cfg.hair === 'afro' && o !== 'bear') el('circle', { cx: 0, cy: -60, r: 18, fill: '#1b120c' }, parts.head);
  el('circle', { cx: 0, cy: -57, r: 13, fill: skin }, parts.head);
  if (o !== 'bear' && cfg.hair !== 'afro') hairSVG(parts.head, cfg.hair, s);
  if (o === 'gym') el('rect', { x: -13, y: -64, width: 26, height: 4, rx: 2, fill: '#e5534b' }, parts.head);
  if (o === 'hoodie') { el('path', { d: 'M-15 -57 Q0 -80 15 -57', fill: 'none', stroke: '#2e3a59', 'stroke-width': 3 }, parts.head); el('rect', { x: -18, y: -61, width: 6, height: 10, rx: 3, fill: '#2e3a59' }, parts.head); el('rect', { x: 12, y: -61, width: 6, height: 10, rx: 3, fill: '#2e3a59' }, parts.head); }
  if (o === 'cape') el('path', { d: 'M-7 -71 L-4 -78 L0 -72 L4 -78 L7 -71 Z', fill: '#ffc857' }, parts.head);
  parts.eyeL = el('ellipse', { cx: -4.5, cy: -58, rx: 1.6, ry: 2.1, fill: '#140d08' }, parts.head);
  parts.eyeR = el('ellipse', { cx: 4.5, cy: -58, rx: 1.6, ry: 2.1, fill: '#140d08' }, parts.head);
  el('circle', { cx: -7, cy: -53, r: 2, fill: '#e5534b', opacity: .25 }, parts.head); el('circle', { cx: 7, cy: -53, r: 2, fill: '#e5534b', opacity: .25 }, parts.head);
  parts.mouth = el('path', { d: 'M-3.5 -52 Q0 -49 3.5 -52', fill: 'none', stroke: '#140d08', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, parts.head);
  parts.bubble = el('g', { opacity: 0 }, root);
  return { root, body, parts };
}
function setTool(a, kind) {
  const g = a.v.parts.tool; while (g.firstChild) g.removeChild(g.firstChild);
  if (kind === 'sponge') el('rect', { x: -4, y: 20, width: 9, height: 6, rx: 2, fill: '#ffc857' }, g);
  if (kind === 'broom') { el('rect', { x: -1, y: -6, width: 2.5, height: 40, fill: '#b9773f' }, g); el('path', { d: 'M-6 32 L7 32 L9 42 L-8 42 Z', fill: '#e8c547' }, g); }
  if (kind === 'bag') el('circle', { cx: 0, cy: 28, r: 7, fill: '#3b3b3b' }, g);
  if (kind === 'dish') el('ellipse', { cx: 0, cy: 22, rx: 8, ry: 3, fill: '#fff', stroke: '#b8ad9c' }, g);
}
function say(a, text, ms = 2200) {
  const b = a.v.parts.bubble; while (b.firstChild) b.removeChild(b.firstChild);
  const w = Math.min(170, 12 + text.length * 5.6), h = 22, me = P(a.x, a.y)[0];
  const crowd = agents.filter(o => o !== a && o.v.parts.bubble.getAttribute('opacity') === '1' && Math.abs(P(o.x, o.y)[0] - me) < 90 && (o.bubbleLevel || 0) === 0).length;
  a.bubbleLevel = crowd ? 1 : 0;
  const y = -96 * a.cfg.size * SCALE - 10 - a.bubbleLevel * 28;
  el('rect', { x: -w / 2, y: y - h, width: w, height: h, rx: 10, fill: '#fff', stroke: '#2b2b2b', 'stroke-width': 1 }, b);
  el('path', { d: `M-5 ${y} L0 ${y + 7} L5 ${y} Z`, fill: '#fff', stroke: '#2b2b2b', 'stroke-width': 1 }, b);
  const t = el('text', { x: 0, y: y - 7, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 700, 'font-family': 'Segoe UI, system-ui, sans-serif', fill: '#2b2b2b' }, b); t.textContent = text;
  b.setAttribute('opacity', 1); clearTimeout(a.sayT); a.sayT = setTimeout(() => { b.setAttribute('opacity', 0); a.bubbleLevel = 0; }, ms);
}
function sparkle(x, y, n = 10, col = '#ffc857') {
  if (reduce) return;
  for (let i = 0; i < n; i++) { const s = el('path', { d: 'M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z', fill: col }, fx);
    const ang = Math.random() * Math.PI * 2, r = 10 + Math.random() * 26; const t0 = performance.now();
    (function step(t) { const p = (t - t0) / 700; if (p > 1) { s.remove(); return; } s.setAttribute('transform', `translate(${x + Math.cos(ang) * r * p} ${y + Math.sin(ang) * r * p - 10 * p}) scale(${1 - p})`); requestAnimationFrame(step); })(t0); }
}

// ---------- agents ----------
const agents = [];
const SCALE = 1.35;   // characters vs room
// solid furniture (world rects: x1, y1, x2, y2), walls and floor edge
const SOLID = [[-1.75, 1.0, 1.75, 1.75], [-1.75, 0.95, -1.0, 1.75], [-1.4, -1.8, -0.4, 0.0], [1.5, -1.8, 1.95, -1.3]];
function keepOut(a) {
  a.x = Math.max(-1.6, Math.min(1.65, a.x)); a.y = Math.max(-1.75, Math.min(0.95, a.y));
  for (const [x1, y1, x2, y2] of SOLID) { const pad = 0.12;
    if (a.x > x1 - pad && a.x < x2 + pad && a.y > y1 - pad && a.y < y2 + pad) {
      const d = [a.x - (x1 - pad), (x2 + pad) - a.x, a.y - (y1 - pad), (y2 + pad) - a.y], m = Math.min(...d);
      if (m === d[0]) a.x = x1 - pad; else if (m === d[1]) a.x = x2 + pad; else if (m === d[2]) a.y = y1 - pad; else a.y = y2 + pad; } }
}
let nextId = 1;
function addAgent(cfg) {
  if (agents.length >= 4) { toast(cfg, 'The kitchen is full! Try another room.'); return; }
  const a = { id: nextId++, cfg, v: makeCharacter(cfg), x: 0.2 + Math.random() * 0.6, y: -1.6, queue: cfg.tasks.filter(t => !done.has(t)), state: 'walk', t: 0, lift: 0, jump: 0, busy: null, greeted: 0, facing: 1, phase: Math.random() * 6 };
  if (!a.queue.length) a.queue = TASKS.filter(t => !done.has(t.id)).map(t => t.id).slice(0, 2);
  agents.push(a); startTask(a); renderPeople(); say(a, rnd(LINES[cfg.personality].hi));
}
function removeAgent(a) { a.v.root.remove(); agents.splice(agents.indexOf(a), 1); renderPeople(); }
function current(a) { return T[a.queue[0]]; }
function startTask(a) {
  const t = current(a);
  if (!t) {   // auto-run: pick up a chore nobody is doing yet
    const taken = new Set(agents.filter(o => o !== a).map(o => o.queue[0]));
    const next = TASKS.find(x => !done.has(x.id) && !taken.has(x.id));
    if (next) { a.queue = [next.id]; say(a, rnd(['I got the ' + next.name.toLowerCase().replace(/^(wipe|clean|wash|empty|put) the /, '') + '!', 'Next up: ' + next.name + '!'])); return startTask(a); }
    a.state = 'idle'; setTool(a, null); say(a, rnd(LINES[a.cfg.personality].done)); return; }
  a.state = 'walk'; a.t = 0; a.best = 9; a.stuck = 0; a.target = [...t.spot];
  setTool(a, { scrub: 'sponge', sweep: 'broom', carry: 'bag', reach: 'dish' }[t.act]);
  if (t.duo && !a.busy) tryDuo(a, t);
}
function finishTask(a) {
  const t = current(a); if (!t) return;
  done.add(t.id); updateClean();
  const g = MESS[t.id]; if (g) { const box = g.getBBox(); sparkle(box.x + box.width / 2, box.y + box.height / 2, 14); g.style.transition = 'opacity .8s'; g.style.opacity = 0; }
  say(a, rnd(LINES[a.cfg.personality].done));
  agents.forEach(o => { if (o !== a && o.queue[0] === t.id) { o.queue.shift(); startTask(o); } });
  a.queue.shift(); a.state = 'cheer'; a.t = 0; renderPeople();
  if (done.size === TASKS.length) setTimeout(() => { agents.forEach(o => { o.state = 'dance'; say(o, 'Kitchen: SPARKLING! ✨'); }); sparkle(240, 200, 40, '#7dc36b'); }, 900);
}

// duo moves, chosen by the task: an alley-oop for the trash, a lift for the high cupboard
function tryDuo(a, t) {
  const partner = agents.find(o => o !== a && !o.busy && o.state !== 'dance');
  if (!partner) return;
  if (t.duo === 'alleyoop') {
    a.busy = partner.busy = { kind: 'alleyoop', thrower: a, dunker: partner, step: 'gather', t: 0 };
    partner.prevTarget = partner.target; partner.target = [BIN[0] - 0.4, BIN[1] + 0.3]; partner.state = 'walk'; partner.best = 9; partner.stuck = 0;
    say(partner, 'Ooh! Lob it to me!');
  }
  if (t.duo === 'lift') {
    const small = a.cfg.size < partner.cfg.size ? a : partner, big = small === a ? partner : a;
    if (big.cfg.size - small.cfg.size < 0.15) return;                     // similar sizes: no lift needed
    a.busy = partner.busy = { kind: 'lift', big, small, step: 'gather', t: 0, owner: a };
    big.prevTarget = big.target; small.prevTarget = small.target;
    big.target = [t.spot[0] + 0.05, t.spot[1] - 0.25]; small.target = [...t.spot]; big.state = small.state = 'walk'; big.best = small.best = 9; big.stuck = small.stuck = 0;
    say(big, small === a ? 'Need a boost, little one?' : 'Up you go!');
  }
}
function runDuo(d, dt) {
  d.t += dt;
  if (d.kind === 'alleyoop') {
    const A = d.thrower, B = d.dunker;
    if (d.step === 'gather' && A.state === 'work' && B.state === 'work') { d.step = 'throw'; d.t = 0; say(A, 'ALLEY…'); d.ball = el('circle', { r: 6, fill: '#3b3b3b' }, fx); setTool(A, null); }
    if (d.step === 'throw') {
      const p = Math.min(1, d.t / 1.1), [ax, ay] = P(A.x, A.y, 1.0), [bx, by] = P(B.x, B.y, 1.6);
      d.ball.setAttribute('cx', ax + (bx - ax) * p); d.ball.setAttribute('cy', ay + (by - ay) * p - Math.sin(p * Math.PI) * 70);
      B.jump = Math.sin(Math.min(1, d.t / 1.1) * Math.PI) * 26;
      if (p >= 1) { d.step = 'dunk'; d.t = 0; say(B, '…OOP! 🏀'); d.ball.remove(); const [x, y] = P(...BIN); sparkle(x, y - 30, 16); }
    }
    if (d.step === 'dunk' && d.t > 0.8) { A.busy = B.busy = null; B.jump = 0; B.target = B.prevTarget || [B.x, B.y]; B.state = 'walk'; B.best = 9; B.stuck = 0; say(A, 'Nothing but bin! 🙌'); finishTask(A); }
  }
  if (d.kind === 'lift') {
    const { big, small, owner } = d;
    if (d.step === 'gather' && big.state === 'work' && small.state === 'work') { d.step = 'up'; d.t = 0; say(big, rnd(['Hup!', 'Lift with the legs!', 'Going up!'])); }
    if (d.step === 'up') { small.lift = Math.min(1, d.t / 0.8) * 34; small.x += (big.x + 0.1 - small.x) * 0.15; small.y += (big.y - 0.14 - small.y) * 0.15; if (d.t > 0.8) { d.step = 'place'; d.t = 0; say(small, 'Dish delivered! 🍽️'); } }
    if (d.step === 'place' && d.t > 1.4) { d.step = 'down'; d.t = 0; const [x, y] = P(-0.5, 1.78, 1.75); sparkle(x, y, 12); }
    if (d.step === 'down') { small.lift = Math.max(0, 1 - d.t / 0.6) * 34; if (d.t > 0.6) {
      big.busy = small.busy = null; small.lift = 0; say(small, 'High five! ✋'); say(big, 'Teamwork!');
      const other = owner === big ? small : big; other.target = other.prevTarget || [other.x, other.y]; other.state = 'walk'; other.best = 9; other.stuck = 0; finishTask(owner); } }
  }
}

// ---------- animation loop ----------
let last = performance.now(), nudgeT = 12;
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const a of agents) {
    a.phase += dt * 6; a.t += dt;
    const t = current(a), p = a.v.parts;
    if (a.state === 'walk') {
      const dx = a.target[0] - a.x, dy = a.target[1] - a.y, dist = Math.hypot(dx, dy), sp = 0.9 * (0.75 + a.cfg.size * 0.25);
      let mx = dist > 0.001 ? dx / dist * sp * dt : 0, my = dist > 0.001 ? dy / dist * sp * dt : 0;
      for (const o of agents) {                                            // space awareness: step around, say hi
        if (o === a || a.busy) continue;
        const ox = a.x - o.x, oy = a.y - o.y, od = Math.hypot(ox, oy);
        if (od < 0.55 && od > 0.0001) { mx += (-oy / od) * 0.6 * dt + ox / od * 0.3 * dt; my += (ox / od) * 0.6 * dt + oy / od * 0.3 * dt;
          if (now - a.greeted > 9000) { a.greeted = o.greeted = now; say(a, rnd(LINES[a.cfg.personality].hi)); setTimeout(() => say(o, rnd(LINES[o.cfg.personality].hi)), 600); } }
      }
      a.x += mx; a.y += my; if (!a.lift) keepOut(a); if (Math.abs(mx) > 0.0005) a.facing = (mx - my) > 0 ? 1 : -1;
      if (dist < a.best - 0.01) { a.best = dist; a.stuck = 0; } else a.stuck = (a.stuck || 0) + dt;
      if (dist < 0.06 || a.stuck > 1.5) { a.best = 9; a.stuck = 0; a.state = 'work'; a.t = 0; if (t && !a.busy) say(a, rnd(LINES[a.cfg.personality].work)); }
    } else if (a.state === 'work' && t && !a.busy) {
      if (t.roam) { a.x = t.spot[0] + Math.sin(a.t * 0.9) * 0.45; a.y = t.spot[1] + Math.sin(a.t * 0.45) * 0.35; keepOut(a); }
      if (a.t > t.dur * (reduce ? 1.6 : 1)) finishTask(a);
    } else if (a.state === 'cheer' && a.t > 1.2) startTask(a);
    // pose
    const act = a.state === 'walk' ? 'walk' : a.state === 'work' ? (t ? t.act : 'idle') : a.state;
    const sw = Math.sin(a.phase * (act === 'walk' ? 1.6 : 2.4));
    p.legL.setAttribute('transform', act === 'walk' ? `rotate(${sw * 22} -6 -20)` : ''); p.legR.setAttribute('transform', act === 'walk' ? `rotate(${-sw * 22} 6 -20)` : '');
    let aL = 10, aR = -10;
    if (act === 'walk') { aL = sw * 25; aR = -sw * 25; }
    if (act === 'scrub') { aR = -60 + sw * 25; aL = 15; }
    if (act === 'sweep') { aR = -20 + sw * 30; aL = -10 + sw * 30; }
    if (act === 'carry') { aR = -15; aL = 15; }
    if (act === 'reach') { aR = -150 + sw * 8; aL = -20; }
    if (a.state === 'cheer' || a.state === 'dance') { aL = 150 + sw * 15; aR = -150 - sw * 15; }
    if (a.busy && a.busy.kind === 'lift' && a.busy.big === a && a.busy.step !== 'gather') { aL = 160; aR = -160; }
    if (a.busy && a.busy.kind === 'alleyoop' && a.busy.dunker === a && a.busy.step !== 'gather') { aR = -170; }
    p.armL.setAttribute('transform', `translate(-14 -42) rotate(${aL})`); p.armR.setAttribute('transform', `translate(14 -42) rotate(${aR})`);
    const blink = Math.sin(now / 900 + a.id * 2) > 0.985 ? 0.2 : 1;
    p.eyeL.setAttribute('ry', 2.1 * blink); p.eyeR.setAttribute('ry', 2.1 * blink);
    const bob = act === 'walk' ? Math.abs(sw) * 2 : act === 'dance' || a.state === 'cheer' ? Math.abs(sw) * 6 : Math.sin(a.phase * 0.5);
    const [sx, sy] = P(a.x, a.y);
    a.v.root.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    a.v.body.setAttribute('transform', `translate(0 ${(-bob - a.lift - a.jump).toFixed(1)}) scale(${a.cfg.size * SCALE * a.facing} ${a.cfg.size * SCALE})`);
    a.v.parts.bubble.setAttribute('transform', `translate(0 ${(-a.lift - a.jump).toFixed(1)})`);
  }
  const duos = new Set(agents.map(a => a.busy).filter(Boolean)); duos.forEach(d => runDuo(d, dt));
  [...agents].sort((m, n) => P(m.x, m.y)[1] - P(n.x, n.y)[1]).forEach(a => actors.appendChild(a.v.root));   // depth order
  nudgeT -= dt; if (nudgeT < 0 && agents.length) { nudgeT = 26; const a = rnd(agents); toast(a.cfg, rnd(LINES[a.cfg.personality].nudge)); }
  requestAnimationFrame(tick);
}

// ---------- notifications from your avatar ----------
function toast(cfg, msg) {
  const t = document.getElementById('toast'); t.innerHTML = '';
  const s = el('svg', { viewBox: '-26 -92 52 92' }, t); const v = makeCharacter({ ...cfg, size: 1 }); s.appendChild(v.root);
  const p = document.createElement('div'); p.innerHTML = `<b>${cfg.name}</b><br>${msg}`; t.appendChild(p);
  t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4200);
}

// ---------- side panel: who's here, what they're doing ----------
function renderPeople() {
  const box = document.getElementById('people');
  box.innerHTML = agents.map(a => `<div class="person"><b>${a.cfg.name}</b> <span style="font-size:12px;color:#5a4a3a">· ${a.cfg.personality}</span>
    <label style="display:block;font-size:12px;margin-top:4px">Doing now <select data-a="${a.id}">${TASKS.filter(t => !done.has(t.id)).map(t => `<option value="${t.id}" ${a.queue[0] === t.id ? 'selected' : ''}>${t.name}</option>`).join('') || '<option>All done!</option>'}</select></label>
    <div class="row"><button class="btn alt" data-done="${a.id}">Mark done</button><button class="btn x" data-rm="${a.id}">Leave room</button></div></div>`).join('');
  box.querySelectorAll('select').forEach(s => s.onchange = () => { const a = agents.find(x => x.id == s.dataset.a); a.queue = [s.value, ...a.queue.filter(q => q !== s.value)]; if (!a.busy) startTask(a); });
  box.querySelectorAll('[data-done]').forEach(b => b.onclick = () => { const a = agents.find(x => x.id == b.dataset.done); if (a && !a.busy && current(a)) finishTask(a); });
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const a = agents.find(x => x.id == b.dataset.rm); if (a && !a.busy) removeAgent(a); });
}
(function picker() {
  const box = document.getElementById('picker');
  PRESETS.forEach(cfg => { const b = document.createElement('button'); b.className = 'pick'; b.setAttribute('aria-label', 'Add ' + cfg.name);
    const s = el('svg', { viewBox: '-30 -100 60 104' }, b); const v = makeCharacter({ ...cfg, size: 1 }); s.appendChild(v.root);
    b.appendChild(document.createTextNode(cfg.name)); b.onclick = () => addAgent({ ...cfg }); box.appendChild(b); });
})();
(function maker() {
  const m = document.getElementById('maker'); const cfg = { name: 'My avatar', size: 0.95, skin: SKIN[3], hair: 'braids', outfit: 'hoodie', personality: 'cheerful', tasks: ['dishes', 'floor'] };
  m.innerHTML = `<label>Name <input id="mk-n" maxlength="16" value="My avatar" style="font:inherit;padding:8px;border-radius:10px;border:1px solid #c9bfb3"></label>
  <div><b style="font-size:13px">Skin</b><div class="sw" id="mk-s">${SKIN.map((c, i) => `<button style="background:${c}" aria-label="Skin tone ${i + 1}" aria-pressed="${c === cfg.skin}" data-c="${c}"></button>`).join('')}</div></div>
  <label>Hair <select id="mk-h">${['puffs', 'afro', 'braids', 'locs', 'fade', 'wrap'].map(h => `<option ${h === cfg.hair ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
  <label>Outfit <select id="mk-o">${[['bear', 'Bear costume'], ['gym', 'Workout gear'], ['cape', 'Cape and tutu'], ['hoodie', 'Hoodie and headphones'], ['apron', 'Apron and gloves'], ['robe', 'Robe and slippers']].map(([v, l]) => `<option value="${v}" ${v === cfg.outfit ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label>Size <select id="mk-z"><option value="0.72">Little</option><option value="0.85">Kid</option><option value="0.95" selected>Teen</option><option value="1.08">Grown-up</option><option value="1.15">Big and strong</option></select></label>
  <label>Personality <select id="mk-p">${Object.keys(LINES).map(p => `<option ${p === cfg.personality ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
  <div class="picker" style="grid-template-columns:1fr"><div class="pick" id="mk-prev" style="cursor:default"></div></div>
  <button class="btn go" id="mk-add">Add me to the kitchen</button>`;
  const prev = () => { const box = document.getElementById('mk-prev'); box.innerHTML = ''; const s = el('svg', { viewBox: '-30 -100 60 104' }, box); s.appendChild(makeCharacter({ ...cfg, size: 1 }).root); };
  m.querySelectorAll('#mk-s button').forEach(b => b.onclick = () => { cfg.skin = b.dataset.c; m.querySelectorAll('#mk-s button').forEach(x => x.setAttribute('aria-pressed', x === b)); prev(); });
  m.querySelector('#mk-h').onchange = e => { cfg.hair = e.target.value; prev(); };
  m.querySelector('#mk-o').onchange = e => { cfg.outfit = e.target.value; prev(); };
  m.querySelector('#mk-z').onchange = e => { cfg.size = +e.target.value; prev(); };
  m.querySelector('#mk-p').onchange = e => { cfg.personality = e.target.value; };
  m.querySelector('#mk-add').onclick = () => { cfg.name = (m.querySelector('#mk-n').value || 'Me').slice(0, 16); addAgent({ ...cfg }); };
  prev();
})();

// start: Bear Cub and Big Mike are already at it
updateClean(); addAgent({ ...PRESETS[0] }); addAgent({ ...PRESETS[1] });
requestAnimationFrame(tick);
