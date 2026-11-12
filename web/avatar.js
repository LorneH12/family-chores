// Cartoon avatars built from parts (never from photos). Shared by the app, the room scenes and the avatar creator.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const SKIN = ['#4A2C17', '#5C3A21', '#6B4226', '#7A4A2A', '#8D5524', '#A0662F'];
  const HAIR = [['puffs', 'Afro puffs'], ['afro', 'Afro'], ['braids', 'Braids'], ['locs', 'Locs'], ['fade', 'Fade'], ['wrap', 'Headwrap']];
  const OUTFIT = [['bear', 'Bear costume'], ['gym', 'Workout gear'], ['cape', 'Cape and tutu'], ['hoodie', 'Hoodie and headphones'], ['apron', 'Apron and gloves'], ['robe', 'Robe and slippers']];
  const SIZE = [[0.72, 'Little'], [0.85, 'Kid'], [0.95, 'Teen'], [1.08, 'Grown-up'], [1.15, 'Big and strong']];
function hairSVG(g, style, s) {
  const c = '#1b120c';
  if (style === 'puffs') { el('circle', { cx: -11, cy: -68, r: 7, fill: c }, g); el('circle', { cx: 11, cy: -68, r: 7, fill: c }, g); el('path', { d: 'M-13 -58 Q0 -72 13 -58 Q0 -64 -13 -58', fill: c }, g); }
  else if (style === 'fade') el('path', { d: 'M-13 -57 Q0 -73 13 -57 L12 -60 Q0 -70 -12 -60 Z', fill: c }, g);
  else if (style === 'locs') { el('path', { d: 'M-14 -56 Q0 -76 14 -56 Q0 -66 -14 -56', fill: c }, g); for (let i = -12; i <= 12; i += 6) el('rect', { x: i - 2, y: -60, width: 4, height: 20, rx: 2, fill: c }, g); }
  else if (style === 'braids') { el('path', { d: 'M-13 -57 Q0 -74 13 -57 Q0 -64 -13 -57', fill: c }, g); el('rect', { x: -15, y: -58, width: 4, height: 24, rx: 2, fill: c }, g); el('rect', { x: 11, y: -58, width: 4, height: 24, rx: 2, fill: c }, g); }
  else if (style === 'wrap') { el('path', { d: 'M-15 -56 Q0 -82 15 -56 Q0 -62 -15 -56', fill: '#e5534b' }, g); el('circle', { cx: 9, cy: -73, r: 6, fill: '#ffc857' }, g); }
}
function draw(parent, cfg) {
  const root = el('g', {}, parent), body = el('g', {}, root);
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

  // A standalone <svg> of the avatar (for pickers, notifications, profile)
  function svg(cfg, label) {
    const s = el('svg', { viewBox: '-30 -100 60 104', role: 'img', 'aria-label': label || 'Avatar' });
    draw(s, { ...cfg, size: 1 }); return s;
  }
  window.Avatar = { draw, svg, SKIN, HAIR, OUTFIT, SIZE };
})();
