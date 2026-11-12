-- Family Chores 013: one task at a time (server-enforced), done only with a photo, room colour by score,
-- and an "8 hours past the plan" reminder that runs on a schedule. Run after 001–012. Safe to re-run. Ends with tests.

-- ---------- one current task per person, with its plan ----------
alter table public.activity add column if not exists started_at timestamptz;
alter table public.activity add column if not exists planned_end timestamptz;
alter table public.activity add column if not exists warned_at timestamptz;

-- Start (or switch to) a task: replaces whatever you were doing. One row per person = one task at a time.
create or replace function public.start_task(job uuid, minutes integer) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.my_member(); fam uuid := public.my_family(); j public.jobs;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if (select role from public.members where id = me) = 'caregiver' then raise exception 'Caregivers don''t take chores'; end if;
  select * into j from public.jobs where id = job and family_id = fam and active; if j.id is null then raise exception 'Chore not found'; end if;
  if minutes < 1 or minutes > 240 then raise exception 'Pick 1 to 240 minutes'; end if;
  insert into public.activity(member_id, family_id, room_id, job_id, started_at, planned_end, warned_at, updated_at)
    values (me, fam, j.room_id, job, now(), now() + make_interval(mins => minutes), null, now())
    on conflict (member_id) do update set room_id = excluded.room_id, job_id = excluded.job_id, task_id = null,
      started_at = excluded.started_at, planned_end = excluded.planned_end, warned_at = null, updated_at = now();
  perform public.start_timer(job, minutes);
end $$;
revoke all on function public.start_task(uuid, integer) from public, anon;
grant execute on function public.start_task(uuid, integer) to authenticated;

-- ---------- done only with a photo ----------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_need_photo') then
    alter table public.submissions add constraint submissions_need_photo check (after_path is not null) not valid; end if;
end $$;
-- (approve_scores can only score a submission, and a submission can't exist without its after-photo)

-- ---------- room colour by score ----------
create table if not exists public.item_state (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  level smallint not null default 0 check (level between 0 and 5),
  member_id uuid references public.members(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.item_state enable row level security;
revoke all on public.item_state from anon, authenticated;
grant select on public.item_state to authenticated;
drop policy if exists is_read on public.item_state;
create policy is_read on public.item_state for select to authenticated using (public.is_member_of(family_id));

-- When a parent approves scores: the chore's item colours in to its score; the person's current task is cleared (they pick the next).
create or replace function public.on_scored() returns trigger language plpgsql security definer set search_path = '' as $$
declare j uuid := (select job_id from public.submissions where id = new.submission_id);
begin
  insert into public.item_state(job_id, family_id, level, member_id, updated_at)
    values (j, new.family_id, greatest(1, least(5, round(new.job_rating)))::smallint, new.member_id, now())
    on conflict (job_id) do update set level = excluded.level, member_id = excluded.member_id, updated_at = now();
  delete from public.activity where member_id = new.member_id and job_id = j;
  delete from public.notifications where member_id = new.member_id and kind = 'timer' and due_at > now() and (data ->> 'job')::uuid = j;
  return new;
end $$;
drop trigger if exists scores_colour on public.scores;
create trigger scores_colour after insert or update on public.scores for each row execute function public.on_scored();

-- Admin/parent reset: back to the uncoloured page (one room, or the whole house).
create or replace function public.reset_colours(room uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare fam uuid := public.my_family(); n int;
begin
  if fam is null or not public.is_parent_of(fam) then raise exception 'Only a parent can reset'; end if;
  delete from public.item_state s using public.jobs j where s.job_id = j.id and s.family_id = fam and (room is null or j.room_id = room);
  get diagnostics n = row_count;
  perform public.log(fam, 'colours_reset', jsonb_build_object('room', room, 'items', n));
  return n;
end $$;
revoke all on function public.reset_colours(uuid) from public, anon;
grant execute on function public.reset_colours(uuid) to authenticated;

-- ---------- 8 hours past the plan → one reminder (runs every 15 minutes) ----------
create or replace function public.remind_overdue() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select a.member_id, a.job_id, j.name from public.activity a join public.jobs j on j.id = a.job_id
           where a.planned_end is not null and a.warned_at is null and a.planned_end < now() - interval '8 hours' loop
    perform public.notify(r.member_id, 'reminder', 'Still on: ' || r.name, '8 hours past your plan. Snap the photo when it''s done, or switch to another task.',
      jsonb_build_object('job', r.job_id, 'intent', 'tired'));
    update public.activity set warned_at = now() where member_id = r.member_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.remind_overdue() from public, anon, authenticated;

-- schedule it (pg_cron). If the extension can't be enabled from here, enable "pg_cron" under Database → Extensions and run this block again.
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'fc-remind-overdue';
  perform cron.schedule('fc-remind-overdue', '*/15 * * * *', 'select public.remind_overdue()');
  raise notice 'overdue reminders scheduled every 15 minutes';
exception when others then raise notice 'pg_cron not available here (%): enable it under Database → Extensions, then re-run this block', sqlerrm;
end $$;

-- ---------- tests ----------
do $test$
declare fa uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); u_pa uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid();
  r uuid := gen_random_uuid(); j1 uuid := gen_random_uuid(); j2 uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); s1 uuid := gen_random_uuid();
  n int; ok boolean; lv int; passed int := 0;
begin
  insert into public.families(id, name) values (fa, 'TEST family O');
  insert into public.settings(family_id) values (fa);
  insert into public.pay_scale(family_id, score, percent) values (fa,5,100),(fa,4,90),(fa,3,75),(fa,2,50),(fa,1,0);
  insert into public.members(id, family_id, user_id, display_name, role, age_group, is_admin) values (pa, fa, u_pa, 'TestAdminO', 'parent', 'adult', true), (c1, fa, u_c1, 'TestChildO', 'child', 'teen', false);
  insert into public.rooms(id, family_id, name) values (r, fa, 'Test room O');
  insert into public.jobs(id, family_id, room_id, name, pay_cents) values (j1, fa, r, 'Test dishes', 300), (j2, fa, r, 'Test floor', 400);
  insert into public.tasks(id, job_id, family_id, name) values (t1, j1, fa, 'Test task');

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.start_task(j1, 20);
  perform public.start_task(j2, 10);                                     -- switch
  select count(*) into n from public.activity where member_id = c1; if n <> 1 then raise exception 'FAIL: % current tasks (want exactly 1)', n; end if; passed := passed + 1;
  select count(*) into n from public.activity where member_id = c1 and job_id = j2 and planned_end > now(); if n <> 1 then raise exception 'FAIL: switch did not replace the task'; end if; passed := passed + 1;
  ok := false; begin insert into public.submissions(family_id, job_id, member_id, occ) values (fa, j1, c1, current_date); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a chore was submitted without a photo'; end if; passed := passed + 1;
  insert into public.submissions(id, family_id, job_id, member_id, occ, after_path) values (s1, fa, j1, c1, current_date, fa || '/' || c1 || '/x/after.jpg'); passed := passed + 1;
  perform public.start_task(j1, 20);
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.approve_scores(s1, jsonb_build_object(t1::text, 4));
  select level into lv from public.item_state where job_id = j1; if lv <> 4 then raise exception 'FAIL: item level % (want 4)', lv; end if; passed := passed + 1;
  select count(*) into n from public.activity where member_id = c1; if n <> 0 then raise exception 'FAIL: finished task still marked current'; end if; passed := passed + 1;
  n := public.reset_colours(r); if n <> 1 then raise exception 'FAIL: reset cleared %', n; end if; passed := passed + 1;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.reset_colours(null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child reset the colours'; end if; passed := passed + 1;
  perform public.start_task(j2, 10);
  execute 'reset role';
  update public.activity set started_at = now() - interval '10 hours', planned_end = now() - interval '9 hours' where member_id = c1;
  n := public.remind_overdue(); if n < 1 then raise exception 'FAIL: overdue reminder not sent'; end if; passed := passed + 1;
  n := public.remind_overdue(); select count(*) into n from public.notifications where member_id = c1 and kind = 'reminder';
  if n <> 1 then raise exception 'FAIL: % overdue reminders (want 1, not repeated)', n; end if; passed := passed + 1;

  delete from public.families where id = fa;
  raise notice 'ALL % ONE-TASK/PHOTO/COLOUR/OVERDUE TESTS PASSED', passed;
end $test$;

select 'One task at a time, photo-required, room colours and overdue reminders installed; ALL TESTS PASSED (test data removed)' as result;
