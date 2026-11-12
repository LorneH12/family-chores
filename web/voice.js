// Avatar voice engine (no AI, runs on the device).
// Each avatar speaks from its own personality + costume vocabulary, fills in real context, and ADAPTS to its person:
// it tries different styles (length, energy, humour, emoji, framing) and learns which ones that person acts on
// (Thompson sampling over styles), what time of day works, and never repeats a recent line.
// Rules of voice: the person owns their choices. Offer options, never instructions to ask for help; no shaming.
(function () {
  const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];
  const P = {   // personality: openers, verbs, praise, quirks, closers, emoji
    goofy: { open: ['Okay okay okay', 'Psst', 'Breaking news', 'Wiggle alert', 'Hey hey', 'Guess what'], praise: ['legendary', 'super-duper', 'ridiculously good', 'top-notch silly-good'],
      quirk: ['(I did a little dance)', '(that was my happy wiggle)', '(true story)', '(no joke… okay, small joke)'], close: ['Let\'s goof and go!', 'Then snacks?', 'Ready, set, wobble!'], emoji: ['🤪', '🎉', '😜', '✨'] },
    hype: { open: ['LET\'S GO', 'Champ', 'Big energy check', 'Game time', 'Yo', 'Listen up, legend'], praise: ['unstoppable', 'elite', 'on fire', 'a machine'],
      quirk: ['(crowd goes wild)', '(air horn noises)', '(that\'s a PR)', '(no days off… except rest days)'], close: ['Warm up and attack it!', 'Clock\'s running, champ!', 'One rep at a time!'], emoji: ['💪', '🔥', '🏆', '⚡'] },
    dramatic: { open: ['Hear ye', 'Darling', 'Plot twist', 'Gasp', 'Behold', 'Picture this'], praise: ['magnificent', 'iconic', 'positively royal', 'breathtaking'],
      quirk: ['(*flips cape*)', '(the crowd weeps)', '(this is my big scene)', '(a standing ovation, frankly)'], close: ['Your stage awaits.', 'Destiny is on line one.', 'Make it iconic.'], emoji: ['👑', '🎭', '💫', '🌟'] },
    chill: { open: ['Hey', 'Yo', 'So', 'Real quick', 'No pressure', 'Low-key'], praise: ['smooth', 'clean', 'solid', 'easy work'],
      quirk: ['(vibes intact)', '(no rush)', '(nice and easy)', '(we stay calm)'], close: ['Whenever you\'re ready.', 'Easy does it.', 'Your pace.'], emoji: ['✌️', '😌', '🎧', '🌊'] },
    bossy: { open: ['Alright now', 'Baby', 'Listen here', 'Mm-hmm', 'Sugar', 'Okay, boss'], praise: ['beautiful', 'done right', 'inspected and approved', 'exactly how it\'s done'],
      quirk: ['(I checked the corners)', '(and I know corners)', '(that\'s a gold star)', '(I\'m proud, don\'t tell anyone)'], close: ['Show me what you\'ve got.', 'You know how we do.', 'Make it shine.'], emoji: ['🧤', '⭐', '💅', '✅'] },
    cheerful: { open: ['Hi friend', 'Good news', 'Hey there', 'Sunshine check', 'Hello hello', 'Yay'], praise: ['awesome', 'wonderful', 'so good', 'amazing'],
      quirk: ['(big smile)', '(happy dance)', '(made my day)', '(high five!)'], close: ['You\'ve got this!', 'Let\'s make it shine!', 'Onward!'], emoji: ['☀️', '😊', '🌈', '🙌'] },
    shy: { open: ['Um, hi', 'Hey… quietly', 'Small thought', 'Hi', 'Just saying', 'If you want'], praise: ['really nice', 'kind of amazing', 'so good', 'great'],
      quirk: ['(tiny cheer)', '(quiet clap)', '(smiling over here)', '(that was cool)'], close: ['Whenever you like.', 'I\'ll be here.', 'You can do it.'], emoji: ['🙂', '🌱', '💛', '✨'] },
  };
  const OUTFIT = {   // costume flavour words folded into lines
    bear: { tag: ['bear-y', 'paw-some', 'un-bear-ably'], bit: ['Rawr!', 'Bear hug incoming.', 'Honey break after?'] },
    gym: { tag: ['beast-mode', 'swole', 'full-rep'], bit: ['Hydrate!', 'Feel the burn.', 'Form check: perfect.'] },
    cape: { tag: ['royal', 'heroic', 'majestic'], bit: ['*cape swish*', 'For the kingdom!', 'Crown on, sleeves up.'] },
    hoodie: { tag: ['fresh', 'on-beat', 'smooth'], bit: ['Drop the beat.', 'Headphones on.', 'This track slaps.'] },
    apron: { tag: ['spotless', 'kitchen-ready', 'polished'], bit: ['Gloves on.', 'Elbow grease, baby.', 'Shine it up.'] },
    robe: { tag: ['cozy', 'comfy', 'fuzzy'], bit: ['Slippers on.', 'Coziest crew ever.', 'Cocoa after?'] },
  };
  // intents: what the avatar wants to say. {x} slots come from context.
  const CORE = {
    nudge: ['{chore} is on your list for {when}', 'your {room} plan has {left} to go', '{chore} today keeps {goal} on track', 'you picked {chore}. Want to knock it out {when}?'],
    start: ['{chore}: let\'s do it', 'timer\'s set for {chore}', 'starting {chore}', 'you chose {chore}, good call'],
    progress: ['{pct}% of the way to {goal}', '{money} closer to {goal}', 'only {money} left for {goal}', 'checkpoint {n} done for {goal}'],
    praise: ['{chore}: {praise}', 'you made {room} look {praise}', '{praise} work: {chore}', '{chore}, done and {praise}'],
    streak: ['{streak} days in a row', 'that\'s a {streak}-day streak', 'streak: {streak} and counting'],
    recover: ['yesterday slipped, today\'s a fresh start', 'new day, your plan is still yours', 'you\'re still in this: {left} to go', 'reset button pressed, {chore} is ready when you are'],
    overload: ['your plan is packed this week', 'that\'s a big week you picked', 'this week has more than your usual load'],
    checkpoint: ['checkpoint coming {when}: {money} saved by then', '{when} is your next checkpoint for {goal}'],
    celebrate: ['{goal}: REACHED', 'you did it, {goal} is yours', 'goal complete: {goal}'],
    working: ['{chore}: on it', '{chore}, watch this', 'working on {chore}', 'one {chore}, coming right up', '{chore}: my specialty'],
    catchcall: ['lob it to me', "I'm open", 'pass it here', 'up top, {name}', 'ready when you are, {name}'],
    throwcall: ['alley…', 'heads up, {name}', 'here it comes', 'catch, {name}'],
    dunk: ['…oop', 'and the crowd goes wild', 'nothing but bin', 'slam dunk'],
    liftoffer: ['need a boost, {name}?', 'up you go, {name}', 'lift off in three, two…', 'elevator going up'],
    lifted: ['dish delivered', 'I can see the top shelf', 'mission complete', 'look how tall I am'],
    highfive: ['high five, {name}', 'teamwork, {name}', 'we did that, {name}', 'up top, {name}'],
    greet: ['coming through, {name}', 'after you, {name}', 'nice moves, {name}', 'teamwork, {name}', 'looking sharp, {name}'],
    teamwork: ['dream team', 'that combo', 'you and me', 'tag team'],
  };
  const FALLBACK = { nudge: 'your next chore is ready when you are', start: 'here we go', progress: "you're making progress", praise: 'that was great work', streak: "you're on a roll",
    recover: 'fresh start today', overload: "that's a big week you picked", checkpoint: 'checkpoint coming up', celebrate: 'goal reached', working: 'working on it', greet: 'hey, teammate', teamwork: 'dream team' };
  const STYLE_ARMS = ['short-calm', 'short-hype', 'long-funny', 'long-calm', 'question', 'emoji-heavy'];

  function freshProfile() { return { arms: Object.fromEntries(STYLE_ARMS.map(a => [a, [1, 1]])), recent: [], hours: Array(24).fill(1), sent: {} }; }
  function beta(a, b, r) { const x = gamma(a, r), y = gamma(b, r); return x / (x + y); }
  function gamma(k, r) { let s = 0; for (let i = 0; i < Math.round(k * 2) + 1; i++) s -= Math.log(r() || 1e-9); return s / 2; }   // rough sampler, fine for picking

  // Make one line. persona: { personality, outfit, nickname }; ctx: { chore, room, goal, money, pct, left, when, streak, n, options:[] }
  function say(persona, intent, ctx = {}, profile = freshProfile(), r = Math.random, opts = {}) {
    const p = P[persona.personality] || P.cheerful, o = OUTFIT[persona.outfit] || null;
    const arms = opts.short ? ['short-calm', 'short-hype'] : STYLE_ARMS;
    let arm = r() < 0.1 ? pick(arms, r) : arms.map(a => [a, beta(profile.arms[a][0], profile.arms[a][1], r)]).sort((x, y) => y[1] - x[1])[0][0];   // 10% keep exploring
    const calm = persona.personality === 'chill' || persona.personality === 'shy';
    const usable = (CORE[intent] || CORE.nudge).filter(t => (t.match(/\{(\w+)\}/g) || []).every(k => { k = k.slice(1, -1); return k === 'praise' || (ctx[k] !== undefined && ctx[k] !== null && ctx[k] !== ''); }));
    const templates = usable.length ? usable : (CORE[intent] || CORE.nudge).filter(t => !/\{(?!praise)/.test(t));
    let line = '';
    for (let tries = 0; tries < 12; tries++) {
      const core = fill(templates.length ? pick(templates, r) : (FALLBACK[intent] || 'your plan is ready'), { ...ctx, praise: (o && r() < 0.4 ? pick(o.tag, r) : pick(p.praise, r)) });
      const parts = [], hype = arm.includes('hype') && !calm;
      const opener = !arm.startsWith('short') || (!opts.short && r() < 0.3);
      if (opener) parts.push(pick(p.open, r) + (hype ? '!' : ','));
      parts.push((opener && !hype ? core : cap(core)) + (/[?!.]$/.test(core) ? '' : arm === 'question' && intent === 'nudge' ? '?' : hype ? '!' : '.'));
      if (arm.startsWith('long')) { if (arm === 'long-funny') parts.push(o && r() < 0.6 ? pick(o.bit, r) : pick(p.quirk, r)); parts.push(pick(p.close, r)); }
      if (intent === 'overload' && ctx.options && ctx.options.length) parts.push('Your call: ' + ctx.options.slice(0, 3).map((x, i) => `(${i + 1}) ${x}`).join(' '));
      if (opts.short && o && r() < 0.35) parts.push(pick(o.bit, r));
      if (arm === 'emoji-heavy') { const e1 = pick(p.emoji, r); parts.push(e1 + pick(p.emoji.filter(e => e !== e1), r)); } else if (r() < 0.5) parts.push(pick(p.emoji, r));
      if (opts.max && parts.join(' ').length > opts.max) continue;
      line = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (!profile.recent.includes(line)) break;
    }
    profile.recent = [line, ...profile.recent].slice(0, 30);
    profile.sent[line] = { arm, at: Date.now() };
    return { text: line, arm };
  }
  // Learning: did the person act after this message (opened the chore, started a timer, marked done)?
  function feedback(profile, arm, acted, hour = new Date().getHours()) {
    const a = profile.arms[arm]; if (!a) return; if (acted) { a[0] += 1; profile.hours[hour] += 1; } else a[1] += 1;
  }
  // Best hour to nudge this person (where they've acted most), within allowed hours
  function bestHour(profile, from = 7, to = 21) { let b = from; for (let h = from; h <= to; h++) if (profile.hours[h] > profile.hours[b]) b = h; return b; }
  const fill = (t, c) => t.replace(/\{(\w+)\}/g, (_, k) => (c[k] !== undefined && c[k] !== null && c[k] !== '' ? c[k] : k === 'when' ? 'today' : k === 'goal' ? 'your goal' : k === 'chore' ? 'your next chore' : k === 'room' ? 'room' : '…'));
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  window.Voice = { say, feedback, bestHour, freshProfile, personalities: Object.keys(P), STYLE_ARMS };
})();
