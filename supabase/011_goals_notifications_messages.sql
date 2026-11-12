-- Family Chores 011: SMART goals with earning paths, notifications (with task timers and preferences),
-- and family messages. Run after 001–010. Safe to re-run. Ends with its own tests (test data removed).

-- ---------- goals ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null default 'money' check (kind in ('money','thing','experience')),
  title text not null check (char_length(title) between 1 and 80),          -- S: what exactly
  why text check (char_length(why) <= 200),                                -- R: why it matters (their words)
  target_cents integer not null check (target_cents between 100 and 1000000), -- M: how much
  target_date date not null,                                               -- T: by when
  if_then text check (char_length(if_then) <= 200),                        -- obstacle plan: "If …, then I'll …"
  plan jsonb,                                                              -- A: the earning path (weekly chores, checkpoints)
  shared_with_parents boolean not null default true,
  parent_match_percent smallint not null default 0 check (parent_match_percent between 0 and 100),
  status text not null default 'active' check (status in ('active','reached','paused','dropped')),
  created_at timestamptz not null default now(),
  reached_at timestamptz,
  check (target_date > created_at::date)
);
create table if not exists public.goal_savings (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  amount_cents integer not null check (amount_cents between -1000000 and 1000000 and amount_cents <> 0),
  source text not null default 'saved' check (source in ('saved','parent_match','withdrawn')),
  note text check (char_length(note) <= 120),
  created_at timestamptz not null default now()
);
alter table public.goals enable row level security; alter table public.goal_savings enable row level security;
revoke all on public.goals, public.goal_savings from anon, authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select on public.goal_savings to authenticated;
drop policy if exists goal_read on public.goals; drop policy if exists goal_insert on public.goals;
drop policy if exists goal_update on public.goals; drop policy if exists goal_delete on public.goals; drop policy if exists gs_read on public.goal_savings;
create policy goal_read on public.goals for select to authenticated using (member_id = public.my_member() or (shared_with_parents and public.is_parent_of(family_id)));
create policy goal_insert on public.goals for insert to authenticated with check (member_id = public.my_member() and family_id = public.my_family());
create policy goal_update on public.goals for update to authenticated using (member_id = public.my_member() or (shared_with_parents and public.is_parent_of(family_id)))
  with check (family_id = (select m.family_id from public.members m where m.id = member_id));
create policy goal_delete on public.goals for delete to authenticated using (member_id = public.my_member());
create policy gs_read on public.goal_savings for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));

-- Put money from your balance toward a goal (can't save more than you have). Parents can add a match.
create or replace function public.save_to_goal(goal uuid, amount_cents integer, note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare g public.goals; me uuid := public.my_member(); parent boolean; avail int; saved int; src text;
begin
  select * into g from public.goals where id = goal;
  if g.id is null then raise exception 'Goal not found'; end if;
  parent := public.is_parent_of(g.family_id) and g.shared_with_parents;
  if g.member_id <> me and not parent then raise exception 'Not your goal'; end if;
  if amount_cents = 0 then raise exception 'Enter an amount'; end if;
  if g.member_id = me then
    src := case when amount_cents > 0 then 'saved' else 'withdrawn' end;
    select coalesce(sum(s.amount_cents), 0) into saved from public.goal_savings s where s.member_id = me and s.source <> 'parent_match';
    avail := public.balance(me) - saved;
    if amount_cents > 0 and amount_cents > avail then raise exception 'You only have % available to save', to_char(avail / 100.0, 'FM$999990.00'); end if;
  else
    if amount_cents < 0 then raise exception 'Parents add matches only'; end if;
    src := 'parent_match';
  end if;
  insert into public.goal_savings(goal_id, family_id, member_id, amount_cents, source, note) values (goal, g.family_id, g.member_id, amount_cents, src, note);
  select coalesce(sum(s.amount_cents), 0) into saved from public.goal_savings s where s.goal_id = goal;
  if saved >= g.target_cents and g.status = 'active' then
    update public.goals set status = 'reached', reached_at = now() where id = goal;
    perform public.notify(g.member_id, 'goal', '🎉 Goal reached: ' || g.title, 'You did it! Time to celebrate.', jsonb_build_object('goal', goal));
    if g.shared_with_parents then perform public.notify_parents(g.family_id, 'goal', 'A goal was reached', (select display_name from public.members where id = g.member_id) || ' reached "' || g.title || '"', jsonb_build_object('goal', goal)); end if;
  end if;
  return saved;
end $$;

-- ---------- notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('reminder','timer','goal','progress','swap','approval','payout','message','room','system')),
  title text not null check (char_length(title) <= 120),
  body text check (char_length(body) <= 400),
  data jsonb,
  due_at timestamptz not null default now(),      -- future = scheduled (timers, reminders)
  pushed_at timestamptz,                           -- set by the push sender (server)
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_member on public.notifications(member_id, due_at desc);
create table if not exists public.notification_prefs (
  member_id uuid primary key references public.members(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  kinds jsonb not null default '{"reminder":true,"timer":true,"goal":true,"progress":true,"swap":true,"approval":true,"payout":true,"message":true,"room":true,"system":true}',
  quiet_start time default '21:00', quiet_end time default '07:00',
  avatar_voice boolean not null default true       -- reminders written in your avatar's personality
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  keys jsonb not null,
  device_label text check (char_length(device_label) <= 40),
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security; alter table public.notification_prefs enable row level security; alter table public.push_subscriptions enable row level security;
revoke all on public.notifications, public.notification_prefs, public.push_subscriptions from anon, authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
drop policy if exists n_read on public.notifications; drop policy if exists n_update on public.notifications;
drop policy if exists np_all on public.notification_prefs; drop policy if exists ps_all on public.push_subscriptions;
create policy n_read on public.notifications for select to authenticated using (member_id = public.my_member() and due_at <= now() + interval '7 days');
create policy n_update on public.notifications for update to authenticated using (member_id = public.my_member()) with check (member_id = public.my_member());
create policy np_all on public.notification_prefs for all to authenticated using (member_id = public.my_member()) with check (member_id = public.my_member() and family_id = public.my_family());
create policy ps_all on public.push_subscriptions for all to authenticated using (member_id = public.my_member()) with check (member_id = public.my_member() and family_id = public.my_family());

-- internal helpers (not callable from the app): create notifications respecting preferences
create or replace function public.notify(member uuid, kind text, title text, body text default null, data jsonb default null, due timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
declare fam uuid; pref jsonb;
begin
  select family_id into fam from public.members where id = member; if fam is null then return; end if;
  select kinds into pref from public.notification_prefs where member_id = member;
  if pref is not null and coalesce((pref ->> kind)::boolean, true) = false then return; end if;
  insert into public.notifications(family_id, member_id, kind, title, body, data, due_at) values (fam, member, kind, left(title, 120), left(body, 400), data, due);
end $$;
create or replace function public.notify_parents(fam uuid, kind text, title text, body text default null, data jsonb default null) returns void
language sql security definer set search_path = '' as $$
  select public.notify(m.id, kind, title, body, data) from public.members m where m.family_id = fam and m.role = 'parent' and m.active and m.status = 'active' $$;
revoke all on function public.notify(uuid,text,text,text,jsonb,timestamptz), public.notify_parents(uuid,text,text,text,jsonb) from public, anon, authenticated;

-- task timers: "I'm starting this chore" → a timer notification when time is up (and a nudge if it runs long)
create table if not exists public.timers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  started_at timestamptz not null default now(),
  minutes smallint not null check (minutes between 1 and 240),
  ends_at timestamptz not null,
  stopped_at timestamptz
);
alter table public.timers enable row level security;
revoke all on public.timers from anon, authenticated;
grant select on public.timers to authenticated;
drop policy if exists tm_read on public.timers;
create policy tm_read on public.timers for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));
create or replace function public.start_timer(job uuid, minutes integer, task uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(); fam uuid := public.my_family(); t uuid; jname text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select name into jname from public.jobs where id = job and family_id = fam; if jname is null then raise exception 'Chore not found'; end if;
  update public.timers set stopped_at = now() where member_id = me and stopped_at is null;
  insert into public.timers(family_id, member_id, job_id, task_id, minutes, ends_at) values (fam, me, job, task, minutes, now() + make_interval(mins => minutes)) returning id into t;
  perform public.notify(me, 'timer', '⏰ Time check: ' || jname, 'Your ' || minutes || '-minute timer is up. Done? Snap your after photo!', jsonb_build_object('timer', t, 'job', job), now() + make_interval(mins => minutes));
  return t;
end $$;
create or replace function public.stop_timer() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(); begin
  update public.timers set stopped_at = now() where member_id = me and stopped_at is null;
  delete from public.notifications where member_id = me and kind = 'timer' and due_at > now() and read_at is null;
end $$;
revoke all on function public.save_to_goal(uuid,integer,text), public.start_timer(uuid,integer,uuid), public.stop_timer() from public, anon;
grant execute on function public.save_to_goal(uuid,integer,text), public.start_timer(uuid,integer,uuid), public.stop_timer() to authenticated;

-- events → notifications
create or replace function public.notify_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare jname text;
begin
  if tg_table_name = 'swaps' and tg_op = 'INSERT' then
    select name into jname from public.jobs where id = new.job_id;
    perform public.notify(new.to_member, 'swap', '🔁 Swap request', (select display_name from public.members where id = new.from_member) || ' asked you to take "' || jname || '"', jsonb_build_object('swap', new.id));
  elsif tg_table_name = 'scores' and tg_op = 'INSERT' then
    perform public.notify(new.member_id, 'approval', '⭐ Chore approved', 'Rating ' || new.job_rating || ' · earned ' || to_char(new.pay_cents / 100.0, 'FM$999990.00'), jsonb_build_object('submission', new.submission_id));
  elsif tg_table_name = 'payouts' and tg_op = 'INSERT' then
    perform public.notify(new.member_id, 'payout', '💸 Payout sent', to_char(new.amount_cents / 100.0, 'FM$999990.00') || ' by ' || new.method || '. Tap "I got it" when it arrives.', jsonb_build_object('payout', new.id));
  elsif tg_table_name = 'submissions' and tg_op = 'INSERT' then
    perform public.notify_parents(new.family_id, 'approval', '📸 Chore to review', (select display_name from public.members where id = new.member_id) || ' finished "' || (select name from public.jobs where id = new.job_id) || '"', jsonb_build_object('submission', new.id));
  end if;
  return new;
end $$;
drop trigger if exists ev_swaps on public.swaps; create trigger ev_swaps after insert on public.swaps for each row execute function public.notify_events();
drop trigger if exists ev_scores on public.scores; create trigger ev_scores after insert on public.scores for each row execute function public.notify_events();
drop trigger if exists ev_payouts on public.payouts; create trigger ev_payouts after insert on public.payouts for each row execute function public.notify_events();
drop trigger if exists ev_submissions on public.submissions; create trigger ev_submissions after insert on public.submissions for each row execute function public.notify_events();

-- ---------- messages (family only) ----------
-- Children and caregivers write to parents (one parent, or all parents). Parents write to anyone in the family.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  from_member uuid not null references public.members(id) on delete cascade,
  to_member uuid references public.members(id) on delete cascade,     -- null = all parents
  goal_id uuid references public.goals(id) on delete set null,
  notification_id uuid references public.notifications(id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_family on public.messages(family_id, created_at desc);
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select, insert, update on public.messages to authenticated;
drop policy if exists msg_read on public.messages; drop policy if exists msg_insert on public.messages; drop policy if exists msg_update on public.messages;
create policy msg_read on public.messages for select to authenticated using (
  from_member = public.my_member() or to_member = public.my_member() or (to_member is null and public.is_parent_of(family_id)));
create policy msg_insert on public.messages for insert to authenticated with check (
  from_member = public.my_member() and family_id = public.my_family()
  and (public.is_parent_of(family_id)
       or to_member is null
       or exists (select 1 from public.members m where m.id = to_member and m.family_id = messages.family_id and m.role = 'parent'))
  and (to_member is null or exists (select 1 from public.members m where m.id = to_member and m.family_id = messages.family_id))
  and (goal_id is null or exists (select 1 from public.goals g where g.id = goal_id and g.member_id = public.my_member())));
create policy msg_update on public.messages for update to authenticated using (to_member = public.my_member() or (to_member is null and public.is_parent_of(family_id)))
  with check (to_member = public.my_member() or (to_member is null and public.is_parent_of(family_id)));
create or replace function public.notify_message() returns trigger language plpgsql security definer set search_path = '' as $$
declare who text := (select display_name from public.members where id = new.from_member);
begin
  if new.to_member is null then perform public.notify_parents(new.family_id, 'message', '💬 ' || who, left(new.body, 140), jsonb_build_object('message', new.id));
  else perform public.notify(new.to_member, 'message', '💬 ' || who, left(new.body, 140), jsonb_build_object('message', new.id)); end if;
  return new;
end $$;
drop trigger if exists ev_messages on public.messages; create trigger ev_messages after insert on public.messages for each row execute function public.notify_message();

-- ---------- tests ----------
do $test$
declare fa uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  u_pa uuid := gen_random_uuid(); u_pb uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid(); u_c2 uuid := gen_random_uuid();
  j uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); g uuid; g2 uuid; n int; ok boolean; saved int; passed int := 0;
begin
  insert into public.families(id, name) values (fa, 'TEST family N');
  insert into public.settings(family_id) values (fa);
  insert into public.members(id, family_id, user_id, display_name, role, age_group, is_admin) values
    (pa, fa, u_pa, 'TestAdminN', 'parent', 'adult', true), (pb, fa, u_pb, 'TestParentN', 'parent', 'adult', false),
    (c1, fa, u_c1, 'TestChildN1', 'child', 'teen', false), (c2, fa, u_c2, 'TestChildN2', 'child', 'kid', false);
  insert into public.jobs(id, family_id, name, pay_cents) values (j, fa, 'Test job N', 1000);
  insert into public.submissions(id, family_id, job_id, member_id, occ, status) values (s1, fa, j, c1, current_date, 'approved');
  insert into public.scores(submission_id, family_id, member_id, task_scores, job_rating, base_cents, percent, pay_cents) values (s1, fa, c1, '{"a":5}', 5, 1000, 100, 1000);
  select count(*) into n from public.notifications where member_id = c1 and kind = 'approval'; if n <> 1 then raise exception 'FAIL: approval did not notify the child'; end if; passed := passed + 1;
  select count(*) into n from public.notifications where member_id in (pa, pb) and kind = 'approval'; if n <> 2 then raise exception 'FAIL: submission did not notify both parents (%)', n; end if; passed := passed + 1;

  -- child 1 sets a goal, saves toward it (can't save more than they have)
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  insert into public.goals(family_id, member_id, kind, title, why, target_cents, target_date, if_then) values
    (fa, c1, 'thing', 'Test sneakers', 'For the season', 1500, current_date + 30, 'If I feel lazy, then I start with the easiest chore') returning id into g; passed := passed + 1;
  ok := false; begin perform public.save_to_goal(g, 5000); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: saved more than the balance'; end if; passed := passed + 1;
  saved := public.save_to_goal(g, 800); if saved <> 800 then raise exception 'FAIL: saved % (want 800)', saved; end if; passed := passed + 1;
  ok := false; begin insert into public.goals(family_id, member_id, title, target_cents, target_date) values (fa, c2, 'x', 500, current_date + 5); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child created a goal for a sibling'; end if; passed := passed + 1;
  insert into public.messages(family_id, from_member, to_member, goal_id, body) values (fa, c1, null, g, 'Can you help me reach this?'); passed := passed + 1;
  ok := false; begin insert into public.messages(family_id, from_member, to_member, body) values (fa, c1, c2, 'hey'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child messaged a sibling directly'; end if; passed := passed + 1;
  perform public.start_timer(j, 15); passed := passed + 1;
  select count(*) into n from public.notifications where kind = 'timer' and due_at > now(); if n <> 1 then raise exception 'FAIL: timer notification not scheduled'; end if; passed := passed + 1;
  perform public.stop_timer();
  select count(*) into n from public.notifications where kind = 'timer' and due_at > now(); if n <> 0 then raise exception 'FAIL: stopped timer still scheduled'; end if; passed := passed + 1;
  ok := false; begin perform public.notify(c2, 'system', 'spoof'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: app users can create notifications directly'; end if; passed := passed + 1;
  execute 'reset role';

  -- sibling sees none of it
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.goals; if n <> 0 then raise exception 'FAIL: sibling sees a goal'; end if; passed := passed + 1;
  select count(*) into n from public.messages; if n <> 0 then raise exception 'FAIL: sibling sees a message'; end if; passed := passed + 1;
  select count(*) into n from public.notifications; if n <> 0 then raise exception 'FAIL: sibling sees notifications'; end if; passed := passed + 1;
  execute 'reset role';

  -- parent sees the shared goal and the message, adds a match that completes the goal
  perform set_config('request.jwt.claims', json_build_object('sub', u_pb, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.messages where goal_id = g; if n <> 1 then raise exception 'FAIL: parent cannot see the goal message'; end if; passed := passed + 1;
  saved := public.save_to_goal(g, 700, 'Parent match'); if saved <> 1500 then raise exception 'FAIL: match total %', saved; end if; passed := passed + 1;
  insert into public.messages(family_id, from_member, to_member, body) values (fa, pb, c1, 'So proud of you!'); passed := passed + 1;
  execute 'reset role';
  select status into ok from (select status = 'reached' as status from public.goals where id = g) x; if not ok then raise exception 'FAIL: goal not marked reached'; end if; passed := passed + 1;
  select count(*) into n from public.notifications where member_id = c1 and kind = 'goal'; if n <> 1 then raise exception 'FAIL: goal-reached notification missing'; end if; passed := passed + 1;

  -- a private goal is hidden from parents
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  insert into public.goals(family_id, member_id, title, target_cents, target_date, shared_with_parents) values (fa, c1, 'Test private', 500, current_date + 10, false) returning id into g2;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.goals where id = g2; if n <> 0 then raise exception 'FAIL: parent sees a private goal'; end if; passed := passed + 1;
  execute 'reset role';

  delete from public.families where id = fa;
  raise notice 'ALL % GOAL/NOTIFICATION/MESSAGE TESTS PASSED', passed;
end $test$;

select 'Goals, notifications, timers and messages installed; ALL TESTS PASSED (test data removed)' as result;
