// Goal path planner: turns "I want $X (or a thing that costs $X) by a date" into a SMART plan built from
// real chores this person can do, at the family's effective prices, within a sensible weekly load for their age.
// Pure function, no network: used by the app and the prototype page.
(function () {
  const CAP = { little: { perDay: 2, minutes: 60 }, kid: { perDay: 3, minutes: 150 }, teen: { perDay: 4, minutes: 240 }, adult: { perDay: 5, minutes: 300 } };   // per week minutes
  const RANK = { little: 0, kid: 1, teen: 2, adult: 3 };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // chores: [{ id, name, room, freq:'daily'|'weekly'|'every', every, pay (cents per time), minutes, minAge }]
  // opts: { age, savedCents, targetCents, start:Date, end:Date, scorePercent (expected pay after rating, default 90), roomBonuses:[{room, bonus, chores:[ids]}] }
  function plan(chores, o) {
    const weeks = Math.max(1, Math.ceil((o.end - o.start) / (7 * 864e5)));
    const need = Math.max(0, o.targetCents - (o.savedCents || 0));
    const perWeek = Math.ceil(need / weeks);
    const cap = CAP[o.age] || CAP.kid, pct = (o.scorePercent || 90) / 100;
    // what this person can do; daily chores can be done on chosen days
    const can = chores.filter(c => RANK[o.age] >= RANK[c.minAge] && c.pay > 0)
      .map(c => ({ ...c, perMin: (c.pay * pct) / Math.max(5, c.minutes || 10), maxTimes: c.freq === 'daily' ? 7 : c.freq === 'weekly' ? 1 : Math.floor(7 / (c.every || 3)) }))
      .sort((a, b) => b.perMin - a.perMin);
    // greedy: best pay-per-minute first, spread across the week, inside the time and per-day caps
    const week = DAYS.map(() => []), picks = [];
    let total = 0, minutes = 0;
    for (const c of can) {
      for (let k = 0; k < c.maxTimes && total < perWeek; k++) {
        if (minutes + (c.minutes || 10) > cap.minutes) break;
        const day = c.freq === 'weekly' ? 6 : [1, 3, 5, 2, 4, 6, 0][k % 7];
        if (week[day].length >= cap.perDay) continue;
        week[day].push(c); total += Math.round(c.pay * pct); minutes += (c.minutes || 10);
        picks.push({ id: c.id, name: c.name, room: c.room, day: DAYS[day], cents: Math.round(c.pay * pct) });
      }
      if (total >= perWeek) break;
    }
    // whole-room bonus if most of a room's chores are already in the plan
    let bonus = null;
    for (const r of o.roomBonuses || []) {
      const inPlan = r.chores.filter(id => picks.some(p => p.id === id)).length;
      if (r.bonus > 0 && inPlan >= Math.ceil(r.chores.length * 0.6)) { bonus = r; total += Math.round(r.bonus); break; }
    }
    const achievable = total >= perWeek;
    const maxWeekly = Math.max(1, total);
    const weeksNeeded = Math.ceil(need / maxWeekly);
    const realisticEnd = new Date(o.start.getTime() + weeksNeeded * 7 * 864e5);
    const checkpoints = Array.from({ length: Math.min(weeks, 12) }, (_, i) => {
      const d = new Date(o.start.getTime() + (i + 1) * 7 * 864e5);
      return { date: d, cents: Math.min(o.targetCents, (o.savedCents || 0) + Math.min(need, perWeek * (i + 1))) };
    });
    return {
      weeks, need, perWeek, weeklyEarnings: total, minutesPerWeek: minutes, achievable, bonus,
      week: week.map((list, i) => ({ day: DAYS[i], chores: list.map(c => ({ name: c.name, cents: Math.round(c.pay * pct) })) })),
      checkpoints, realisticEnd,
      // the person decides; these are choices, not instructions
      options: achievable ? [] : [
        { kind: 'later', text: `Give it until ${realisticEnd.toDateString()}: ${weeksNeeded} weeks at about $${(maxWeekly / 100).toFixed(2)} a week` },
        { kind: 'milestone', text: `Make $${(Math.min(need, maxWeekly * weeks) / 100).toFixed(2)} your first milestone by the date, then go for the rest` },
        { kind: 'bigger', text: 'Take on a bigger earner: claim a whole room for the bonus, or add a weekend chore' },
        { kind: 'trim', text: 'Pick a version of the goal that costs less now, and upgrade later' },
      ],
    };
  }
  window.GoalPlan = { plan, CAP };
})();
