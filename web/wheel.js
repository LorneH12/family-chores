// Room wheel prototype: a 3D drum of toy rooms. Swipe/scroll/keys spin it; drag the front room to turn it (12 rendered angles).
const ROOMS = [
  ['kitchen', 'Kitchen', 60, 15, 6, 2], ['living-room', 'Living room', 30, 10, 4, 4], ['main-bathroom', 'Main bathroom', 40, 10, 5, 1],
  ['hallway-and-entry', 'Hallway & entry', 20, 10, 3, 3], ['laundry', 'Laundry', 30, 10, 3, 2], ['dining-room', 'Dining room', 20, 10, 3, 5],
  ['yard-and-outside', 'Yard & outside', 50, 20, 5, 1], ['garage', 'Garage', 30, 10, 3, 0], ['bedroom', 'Bedroom', 20, 10, 3, 4],
  ['getting-ready', 'Getting ready', 5.25, 0, 3, 5]
].map(([slug, name, value, bonus, chores, sparkle]) => ({ slug, name, value, bonus, chores, sparkle }));

const drum = document.getElementById('drum'), panel = document.getElementById('panel');
const N = ROOMS.length, STEP = 360 / N, RADIUS = Math.round(130 / Math.tan(Math.PI / N));
let angle = 0, target = 0, frame = 5, front = 0;
drum.style.transform = `translateZ(${-RADIUS}px)`;
const money = v => '$' + (Number.isInteger(v) ? v : v.toFixed(2));

const cards = ROOMS.map((r, i) => {
  const b = document.createElement('button'); b.className = 'card'; b.setAttribute('aria-label', r.name);
  b.innerHTML = `<div class="art" style="background-image:url(rooms/${r.slug}.webp)"></div><div class="dust"></div><span class="tag">${r.name}</span>`;
  b.onclick = () => { if (i !== front) spinTo(i); };
  drum.appendChild(b); return b;
});
// reduced-motion list
document.getElementById('list').innerHTML = ROOMS.map(r => `<p><b>${r.name}</b> · ${money(r.value)}/week</p>`).join('');

function layout() {
  angle += (target - angle) * 0.18;
  front = ((Math.round(-angle / STEP) % N) + N) % N;
  cards.forEach((c, i) => {
    let a = i * STEP + angle; a = ((a + 180) % 360 + 360) % 360 - 180;           // -180..180, 0 = facing us
    const vis = Math.max(0, 1 - Math.abs(a) / 95);
    c.style.transform = `rotateX(${-a}deg) translateZ(${RADIUS}px) scale(${0.72 + 0.28 * vis})`;
    c.style.opacity = vis.toFixed(3); c.style.pointerEvents = vis > 0.3 ? 'auto' : 'none';
    c.classList.toggle('front', i === front); c.tabIndex = i === front ? 0 : -1;
    const f = i === front ? frame : 5;
    c.firstChild.style.backgroundPosition = `${(f / 11) * 100}% 0`;
    c.children[1].style.opacity = ((5 - ROOMS[i].sparkle) / 5 * 0.45).toFixed(2);   // dust where sparkle is low
  });
  if (front !== layout.last) { layout.last = front; showPanel(); }
  requestAnimationFrame(layout);
}
function spinTo(i) { const cur = Math.round(-target / STEP); let d = i - (((cur % N) + N) % N); if (d > N / 2) d -= N; if (d < -N / 2) d += N; target = -(cur + d) * STEP; }
function showPanel() {
  const r = ROOMS[front];
  panel.innerHTML = `<h2>${r.name}</h2><div class="meta">${money(r.value)} a week · ${r.chores} chores ·
    sparkle <span class="spark">${[0, 1, 2, 3, 4].map(k => `<i class="${k < r.sparkle ? 'on' : ''}"></i>`).join('')}</span></div>
    <div class="chips">${r.bonus ? `<span class="chip">🏆 Whole room: +${money(r.bonus)} bonus</span><span class="chip">⚠️ Miss it: −${money(r.bonus * 1.5)}</span>` : '<span class="chip">One chore at a time</span>'}
    <span class="chip">🥉 Bronze → 🥇 Room Master</span></div>
    <div class="row">${r.bonus ? '<button class="btn go" id="claim">Claim the whole room</button>' : ''}<button class="btn alt" id="pick">Pick chores</button></div>`;
  const c = document.getElementById('claim'); if (c) c.onclick = () => celebrate(`${r.name} is yours this week!`);
  document.getElementById('pick').onclick = () => celebrate('Chore list opens here');
}

// input: vertical swipe / wheel spins; horizontal drag on the front room turns it
let sy = null, sx = null, mode = null, startTarget = 0, startFrame = 5;
const stage = document.getElementById('stage');
stage.addEventListener('pointerdown', e => { sy = e.clientY; sx = e.clientX; mode = null; startTarget = target; startFrame = frame; });
addEventListener('pointermove', e => {
  if (sy === null) return;
  const dy = e.clientY - sy, dx = e.clientX - sx;
  if (!mode && Math.hypot(dx, dy) > 8) mode = Math.abs(dy) > Math.abs(dx) ? 'spin' : 'turn';
  if (mode === 'spin') target = startTarget + dy * 0.35;
  if (mode === 'turn') frame = Math.max(0, Math.min(11, Math.round(startFrame + dx / 18)));
});
addEventListener('pointerup', () => { if (mode === 'spin') target = Math.round(target / STEP) * STEP; sy = null; mode = null; });
addEventListener('wheel', e => { target -= Math.sign(e.deltaY) * STEP; }, { passive: true });
addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') target -= STEP; if (e.key === 'ArrowUp') target += STEP;
  if (e.key === 'ArrowLeft') frame = Math.max(0, frame - 1); if (e.key === 'ArrowRight') frame = Math.min(11, frame + 1);
});
document.getElementById('up').onclick = () => { target += STEP; };
document.getElementById('down').onclick = () => { target -= STEP; };

// celebration burst (confetti)
const cv = document.getElementById('burst'), cx = cv.getContext('2d');
function celebrate(msg) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { alert(msg); return; }
  cv.width = innerWidth; cv.height = innerHeight;
  const bits = Array.from({ length: 90 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.45, vx: (Math.random() - .5) * 12, vy: -Math.random() * 12 - 4,
    c: ['#ffc857', '#2f6f4f', '#ff8a65', '#7cb7e8', '#a98be6'][Math.floor(Math.random() * 5)], r: 3 + Math.random() * 4 }));
  let t = 0; (function step() { cx.clearRect(0, 0, cv.width, cv.height);
    bits.forEach(b => { b.x += b.vx; b.y += b.vy; b.vy += 0.35; cx.fillStyle = b.c; cx.fillRect(b.x, b.y, b.r, b.r * 1.6); });
    if (++t < 90) requestAnimationFrame(step); else cx.clearRect(0, 0, cv.width, cv.height); })();
  panel.querySelector('h2').textContent = msg;
}
layout();
