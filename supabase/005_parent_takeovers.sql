-- Family Chores: a parent picks up a chore/shift: for cash, as a penalty, or as a demonstration.
-- Run after 001 (and 003). Safe to re-run. Ends with its own tests (test data removed).

create table if not exists public.takeovers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  occ date not null,
  child_member uuid references public.members(id) on delete set null,   -- null = an unclaimed/open shift
  parent_member uuid not null references public.members(id) on delete cascade,
  reason text not null check (reason in ('cash','penalty','demo')),
  penalty_id uuid references public.penalties(id) on delete set null,
  note text check (char_length(note) <= 120),
  created_at timestamptz not null default now(),
  unique (job_id, occ)
);
alter table public.takeovers enable row level security;
revoke all on public.takeovers from anon, authenticated;
grant select on public.takeovers to authenticated;
drop policy if exists take_read on public.takeovers;
create policy take_read on public.takeovers for select to authenticated using (public.is_member_of(family_id));

-- cash: chore moves to the parent, who earns its pay when scored.
-- penalty: chore moves to the parent; the child gets a penalty (default = the job's pay).
-- demo: parent shows how; the chore stays the child's; no money changes.
create or replace function public.parent_takeover(job uuid, day date, child uuid, why text, penalty_cents integer default null, note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare j public.jobs; me uuid := public.my_member(); t uuid; pen uuid; amt int;
begin
  select * into j from public.jobs where id = job;
  if j.id is null or not public.is_parent_of(j.family_id) then raise exception 'Only a parent can do this'; end if;
  if why not in ('cash','penalty','demo') then raise exception 'Reason must be cash, penalty or demo'; end if;
  if child is not null and not exists (select 1 from public.members where id = child and family_id = j.family_id and role = 'child') then
    raise exception 'That child is not in this family'; end if;
  if why = 'penalty' then
    if child is null then raise exception 'A penalty needs a child'; end if;
    amt := coalesce(penalty_cents, j.pay_cents);
    if amt < 1 or amt > 100000 then raise exception 'Penalty must be between 0.01 and 1000'; end if;
    insert into public.penalties(family_id, member_id, amount_cents, reason, created_by)
      values (j.family_id, child, amt, left('Parent took over "' || j.name || '"' || coalesce(': ' || note, ''), 120), me)
      returning id into pen;
  end if;
  insert into public.takeovers(family_id, job_id, occ, child_member, parent_member, reason, penalty_id, note)
    values (j.family_id, job, day, child, me, why, pen, note)
    on conflict (job_id, occ) do update set child_member = excluded.child_member, parent_member = excluded.parent_member,
      reason = excluded.reason, penalty_id = excluded.penalty_id, note = excluded.note, created_at = now()
    returning id into t;
  perform public.log(j.family_id, 'takeover_' || why, jsonb_build_object('job', job, 'occ', day, 'child', child, 'penalty_cents', amt));
  return t;
end $$;

-- Undo a takeover (and its penalty).
create or replace function public.undo_takeover(takeover uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.takeovers; begin
  select * into t from public.takeovers where id = takeover;
  if t.id is null or not public.is_parent_of(t.family_id) then raise exception 'Only a parent can do this'; end if;
  if t.penalty_id is not null then delete from public.penalties where id = t.penalty_id; end if;
  delete from public.takeovers where id = takeover;
  perform public.log(t.family_id, 'takeover_undone', jsonb_build_object('takeover', takeover));
end $$;

revoke all on function public.parent_takeover(uuid,date,uuid,text,integer,text), public.undo_takeover(uuid) from public, anon;
grant execute on function public.parent_takeover(uuid,date,uuid,text,integer,text), public.undo_takeover(uuid) to authenticated;

-- ---------- tests ----------
do $test$
declare fa uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  u_pa uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid(); u_c2 uuid := gen_random_uuid(); j uuid := gen_random_uuid();
  t uuid; n int; ok boolean; passed int := 0;
begin
  insert into public.families(id, name) values (fa, 'TEST family T');
  insert into public.settings(family_id) values (fa);
  insert into public.members(id, family_id, user_id, display_name, role, age_group) values
    (pa, fa, u_pa, 'TestParentT', 'parent', 'adult'), (c1, fa, u_c1, 'TestKidT1', 'child', 'teen'), (c2, fa, u_c2, 'TestKidT2', 'child', 'kid');
  insert into public.jobs(id, family_id, name, pay_cents) values (j, fa, 'Test job T', 300);

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false; begin perform public.parent_takeover(j, current_date, c2, 'penalty'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child penalised a sibling'; end if; passed := passed + 1;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  t := public.parent_takeover(j, current_date, c1, 'penalty', null, 'Not done to standard'); passed := passed + 1;
  select count(*) into n from public.penalties where member_id = c1 and amount_cents = 300; if n <> 1 then raise exception 'FAIL: penalty not created at job pay'; end if; passed := passed + 1;
  perform public.undo_takeover(t);
  select count(*) into n from public.penalties where member_id = c1; if n <> 0 then raise exception 'FAIL: undo left the penalty'; end if; passed := passed + 1;
  perform public.parent_takeover(j, current_date, c1, 'cash'); passed := passed + 1;
  select count(*) into n from public.penalties; if n <> 0 then raise exception 'FAIL: cash takeover created a penalty'; end if; passed := passed + 1;
  perform public.parent_takeover(j, current_date + 1, null, 'demo', null, 'Showing how'); passed := passed + 1;
  ok := false; begin perform public.parent_takeover(j, current_date + 2, null, 'penalty'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: penalty without a child accepted'; end if; passed := passed + 1;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.takeovers; if n <> 2 then raise exception 'FAIL: family board shows % takeovers (want 2)', n; end if; passed := passed + 1;
  select count(*) into n from public.penalties; if n <> 0 then raise exception 'FAIL: sibling sees penalties'; end if; passed := passed + 1;
  execute 'reset role';

  delete from public.families where id = fa;
  raise notice 'ALL % TAKEOVER TESTS PASSED', passed;
end $test$;

select 'Parent takeovers installed; ALL TAKEOVER TESTS PASSED (test data removed)' as result;
