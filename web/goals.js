// Goal planner prototype: starter chores (prices per time, estimated minutes, youngest age group).
const CHORES = [
  ['Wash the dishes', 'Kitchen', 'daily', 300, 20, 'kid'], ['Wipe counters and stovetop', 'Kitchen', 'daily', 100, 8, 'kid'],
  ['Sweep and mop the kitchen floor', 'Kitchen', 'weekly', 600, 25, 'kid'], ['Clean microwave and fronts', 'Kitchen', 'weekly', 400, 15, 'kid'],
  ['Empty trash and recycling', 'Kitchen', 'every', 150, 5, 'kid', 3], ['Clean out the fridge', 'Kitchen', 'weekly', 350, 15, 'teen'],
  ['Tidy the living room', 'Living room', 'daily', 100, 10, 'little'], ['Vacuum the living room', 'Living room', 'weekly', 500, 20, 'kid'],
  ['Dust surfaces', 'Living room', 'weekly', 400, 15, 'kid'], ['Clean windows', 'Living room', 'weekly', 400, 20, 'kid'],
  ['Clean the toilet', 'Main bathroom', 'weekly', 800, 15, 'teen'], ['Scrub the tub and shower', 'Main bathroom', 'weekly', 1000, 30, 'teen'],
  ['Sink, mirror and counter', 'Main bathroom', 'weekly', 600, 15, 'kid'], ['Restock toilet paper and towels', 'Main bathroom', 'weekly', 200, 5, 'little'],
  ['Tidy the hallway and shoes', 'Hallway', 'weekly', 300, 10, 'little'], ['Set the table', 'Dining room', 'daily', 50, 5, 'little'],
  ['Clear and wipe the table', 'Dining room', 'daily', 50, 5, 'little'], ['Fold and put away laundry', 'Laundry', 'weekly', 800, 30, 'kid'],
  ['Mow the lawn', 'Yard', 'weekly', 1500, 45, 'teen'], ['Water the plants', 'Yard', 'weekly', 200, 10, 'little'],
  ['Make the bed', 'Bedroom', 'daily', 50, 3, 'little'], ['Vacuum the bedroom', 'Bedroom', 'weekly', 300, 15, 'kid'],
].map(([name, room, freq, pay, minutes, minAge, every], i) => ({ id: 'c' + i, name, room, freq, pay, minutes, minAge, every }));
const ROOMS = [{ room: 'Kitchen', bonus: 1500 }, { room: 'Main bathroom', bonus: 1000 }, { room: 'Yard', bonus: 2000 }]
  .map(r => ({ ...r, chores: CHORES.filter(c => c.room === r.room).map(c => c.id) }));
const $ = s => document.querySelector(s), f = $('#f');
const d = new Date(); d.setDate(d.getDate() + 42); f.date.value = d.toISOString().slice(0, 10);
const money = c => '$' + (c / 100).toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

f.onsubmit = e => {
  e.preventDefault();
  const start = new Date(), end = new Date(f.date.value + 'T12:00:00');
  if (!(end > start)) { $('#out').innerHTML = '<div class="card warn">Pick a date in the future.</div>'; return; }
  const target = Math.round(+f.amount.value * 100), saved = Math.round(+f.saved.value * 100);
  const p = GoalPlan.plan(CHORES, { age: f.age.value, savedCents: saved, targetCents: target, start, end, roomBonuses: ROOMS });
  const pct = Math.min(100, Math.round(saved / target * 100));
  $('#out').innerHTML = `<div class="card"><h2 style="margin:0">${esc(f.title.value)}</h2>
  <div class="bar" role="img" aria-label="${pct}% saved"><i style="width:${pct}%"></i></div>
  <p class="muted" style="margin:0">${money(saved)} of ${money(target)} · ${p.weeks} weeks to go</p>
  <div class="smart">
    <div><b class="l">S</b><span><b>Specific:</b> ${esc(f.title.value)} by ${end.toDateString()}.</span></div>
    <div><b class="l">M</b><span><b>Measurable:</b> ${money(p.need)} more, about <b>${money(p.perWeek)} a week</b>. Your progress bar fills as you save.</span></div>
    <div><b class="l">A</b><span><b>Achievable:</b> ${p.achievable ? `<span class="ok">Yes.</span> This plan earns about ${money(p.weeklyEarnings)} a week in about ${p.minutesPerWeek} minutes.` : `<span class="warn">Not by that date with your chores.</span> Best you can do is about ${money(p.weeklyEarnings)} a week.`}${p.bonus ? ` Includes the <b>${p.bonus.room}</b> whole-room bonus (+${money(p.bonus.bonus)}).` : ''}</span></div>
    <div><b class="l">R</b><span><b>Relevant:</b> ${esc(f.why.value || 'It matters to you.')}</span></div>
    <div><b class="l">T</b><span><b>Time-bound:</b> weekly checkpoints: ${p.checkpoints.slice(0, 4).map(c => `${c.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} → ${money(c.cents)}`).join(' · ')}${p.checkpoints.length > 4 ? ' …' : ''}</span></div>
  </div></div>
  <div class="card"><h3 style="margin:0">Your week</h3><div class="week">${p.week.map(w => `<div class="day"><b>${w.day}</b>${w.chores.map(c => `<span class="chip">${esc(c.name)}<br><b>${money(c.cents)}</b></span>`).join('') || '<span class="muted">Rest day</span>'}</div>`).join('')}</div>
  <p class="muted">Prices assume a typical rating (90% of full pay). Great work earns more.</p></div>
  ${p.achievable ? '' : `<div class="card"><h3 style="margin:0">Make it work</h3><ul>${p.options.map(o => `<li>${esc(o.text)}</li>`).join('')}</ul></div>`}
  <div class="card"><h3 style="margin:0">Your if-then plan</h3><p>${esc(f.ifthen.value)}</p><p class="muted">Share this goal with a parent from Messages: they can cheer you on or add a match.</p></div>`;
  $('#out').scrollIntoView({ behavior: 'smooth' });
};
