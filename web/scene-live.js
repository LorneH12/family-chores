// Live mode for the room scene (scene.html?room=<room id>): the family's real avatars, current tasks, tiredness and room colours.
// Read-only: starting a chore, adding the photo and scoring all happen in the app. Refreshes every 20 seconds.
(function () {
  if (!LIVE_ROOM) return;
  document.body.classList.add('live'); document.documentElement.style.background = 'transparent';
  const msg = t => { const h = document.getElementById('roomtitle'); h.textContent = t; h.style.display = 'block'; };
  const ART = n => { n = (n || '').toLowerCase(); return n.includes('kitchen') ? 'kitchen' : n.includes('bed') ? 'bedroom' : null; };
  // which part of the drawing a chore colours in, by its name
  const MATCH = {
    kitchen: [[/away|cupboard/, 'putaway'], [/dish/, 'dishes'], [/counter|stove|microwave|appliance/, 'counters'], [/island|table/, 'island'],
              [/floor|sweep|mop/, 'floor'], [/fridge/, 'fridge'], [/trash|recycl|\bbins?\b|garbage/, 'trash']],
    bedroom: [[/\bbed\b|sheets/, 'bed'], [/vacuum/, 'vacuum'], [/toy|floor|tidy|pick up|clothes|laundry|put away/, 'toys']],
  };
  const STAND = { kitchen: [0.45, -0.6], bedroom: [-0.35, -0.5] };
  let art, jobs = [], me = null, members = [], avatars = {}, prevLevel = {};
  const byMember = new Map();

  function cfgFor(mid) {
    const av = avatars[mid], m = members.find(x => x.id === mid) || {};
    const c = av ? { ...av.config, personality: av.personality, name: av.nickname || m.display_name }
                 : { skin: '#6B4226', hair: 'afro', outfit: 'hoodie', personality: 'cheerful', name: m.display_name || 'Someone', size: m.role === 'parent' ? 1.08 : 0.95 };
    c.size = +c.size || 1; c.start = art; c.plan = []; c.stay = !!me && mid === me.id; return c;
  }
  function spawn(mid, key) {
    const c = cfgFor(mid); if (key) c.plan = [key];
    addAgent(c); const a = agents[agents.length - 1]; if (!a || a.cfg !== c) return null;
    byMember.set(mid, a); return a;
  }
  function finish(a, mid, stars) {                       // their chore was scored: celebrate, then they head off
    byMember.delete(mid); a.plan = []; a.cur = null; a.busy = null; setTool(a, null);
    a.refreshed = clockNow(); a.state = 'cheer'; a.t = 0; a.vz = 2.2;
    say(a, V(a, stars >= 4 ? 'celebrate' : 'partial', { goal: 'that chore', chore: 'that chore', room: 'the ' + art }));
    if (a.cfg.stay) return;                              // me: stay in the room
    a.cfg.stay = true;                                   // idle after the cheer, then leave
    setTimeout(() => { if (byMember.has(mid)) return; a.gone = true; a.dest = { room: 'outside', then: 'out' }; a.bestD = 9; a.stuckT = 0; a.state = 'leaving'; a.target = [...ROOMS[a.room].door]; }, 2600);
  }
  function walkAway(a, mid) { byMember.delete(mid); a.cfg.stay = true; a.plan = []; a.cur = null; setTool(a, null);
    a.gone = true; a.dest = { room: 'outside', then: 'out' }; a.bestD = 9; a.stuckT = 0; a.state = 'leaving'; a.target = [...ROOMS[a.room].door]; }

  async function sync(first) {
    const [acts, states] = await Promise.all([
      API.select('activity', `select=member_id,job_id,started_at,planned_end&room_id=eq.${LIVE_ROOM}`),
      API.select('item_state', 'select=job_id,level,member_id,updated_at')]);
    // colours: each chore's best approved score colours its part of the drawing (stays until an admin resets)
    for (const k in level) delete level[k];
    const lv = {}; states.forEach(s => { lv[s.job_id] = s; });
    jobs.forEach(j => { const t = TASK['live:' + j.id], s = lv[j.id]; if (!t || !s) return;
      t.items.forEach(it => { const k = art + ':' + it; level[k] = Math.max(level[k] || 0, s.level); }); });
    refreshColors();
    if (!first) for (const k in level) if ((level[k] || 0) > (prevLevel[k] || 0)) {
      const t = Object.values(TASK).find(x => x.room === art && x.items.includes(k.split(':')[1])); if (t) { const [x, y] = P(t.spot[0], t.spot[1] + 0.4, 1); sparkle(x, y, 12 + level[k] * 4, level[k] === 5 ? '#ffc857' : '#9fd3e6'); } }
    prevLevel = { ...level };
    // people: one avatar per person working in this room on their one current task
    const here = new Map(acts.filter(a => a.job_id && TASK['live:' + a.job_id]).map(a => [a.member_id, a]));
    for (const [mid, a] of [...byMember]) {
      const now = here.get(mid);
      if (now) continue;
      if (a.cur) {
        const job = a.cur.slice(5), s = lv[job], scored = s && s.member_id === mid && Date.parse(s.updated_at) > Date.now() - 15 * 60e3;
        if (scored) finish(a, mid, s.level); else if (mid === me?.id) { a.plan = []; a.cur = null; setTool(a, null); a.state = 'idle'; } else walkAway(a, mid);
      }
    }
    for (const [mid, act] of here) {
      const key = 'live:' + act.job_id; let a = byMember.get(mid);
      if (!a) { a = spawn(mid, key); if (!a) continue;
        if (first) { a.room = art; [a.x, a.y] = TASK[key].spot; a.state = 'work'; a.t = 0; } }
      else if (a.cur !== key) { a.plan = [key]; a.busy = null; startTask(a, key); }
      const pe = Date.parse(act.planned_end); if (pe) { a.plannedEnd = pe; a.startedAt = Date.parse(act.started_at) || a.startedAt; }
    }
    if (me && !byMember.has(me.id) && avatars[me.id]) { const a = spawn(me.id, null); if (a) { [a.x, a.y] = STAND[art]; a.state = 'idle'; } }
  }

  async function init() {
    if (!window.API || !API.ready) { msg('This preview needs the app settings.'); return; }
    if (!API.userId()) { msg('Sign in to the app to see your family here.'); return; }
    try {
      const mine = await API.select('members', `select=id,family_id,display_name,role&user_id=eq.${API.userId()}`); me = mine[0] || null;
      if (!me) { msg('Join or create your family in the app first.'); return; }
      const [rooms, js, ms, avs] = await Promise.all([API.select('rooms', `select=id,name,emoji&id=eq.${LIVE_ROOM}`),
        API.select('jobs', `select=id,name,room_id&room_id=eq.${LIVE_ROOM}&active=is.true&order=position`),
        API.select('members', `select=id,display_name,role&family_id=eq.${me.family_id}`), API.select('avatars', 'select=*')]);
      const room = rooms[0]; art = room && ART(room.name);
      if (!art) { msg(room ? 'This room has no scene yet.' : 'Room not found.'); return; }
      jobs = js; members = ms; avatars = Object.fromEntries(avs.map(a => [a.member_id, a]));
      const used = new Set();
      jobs.forEach((j, i) => { const n = j.name.toLowerCase(), hit = MATCH[art].find(([re]) => re.test(n)), tpl = ROOMS[art].tasks.find(t => t.id === (hit && hit[1]));
        const base = tpl || ROOMS[art].tasks[i % ROOMS[art].tasks.length];
        TASK['live:' + j.id] = { ...base, id: j.id, name: j.name, room: art, items: tpl ? tpl.items : [], duo: tpl && !used.has(tpl.id) ? tpl.duo : undefined }; if (tpl) used.add(tpl.id); });
      ROOMS[art].title = `${room.emoji || ''} ${room.name}`.trim();
      view = art; drawRoom();
      await sync(true);
      setInterval(() => { if (!document.hidden) sync(false).catch(() => {}); }, 20000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(false).catch(() => {}); });
    } catch (e) { msg('Could not load the room: ' + (e.message || e)); }
  }
  init();
})();
