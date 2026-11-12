-- Family Chores 007: admin flag, scoreboard visibility, parent-to-parent assignments/events with private
-- rewards, autopilot settings, price limits and price history. Run after 001–006. Safe to re-run.
-- Ends with its own tests (test data removed).

-- ---------- admin ----------
alter table public.members add column if not exists is_admin boolean not null default false;
update public.members m set is_admin = true
  where m.role = 'parent' and not exists (select 1 from public.members x where x.family_id = m.family_id and x.is_admin)
    and m.created_at = (select min(created_at) from public.members y where y.family_id = m.family_id and y.role = 'parent');

create or replace function public.is_admin_of(fam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'parent' and is_admin and family_id = fam) $$;

-- the family creator becomes admin
create or replace function public.create_family(family_name text, my_name text, my_emoji text default '🧑')
returns uuid language plpgsql security definer set search_path = '' as $$
declare fam uuid; me uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Sign in with email first'; end if;
  if exists (select 1 from public.families) then raise exception 'This app already has a family'; end if;
  insert into public.families(name) values (family_name) returning id into fam;
  insert into public.members(family_id, user_id, display_name, emoji, role, age_group, is_admin) values (fam, auth.uid(), my_name, my_emoji, 'parent', 'adult', true) returning id into me;
  insert into public.settings(family_id) values (fam);
  insert into public.pay_scale(family_id, score, percent) values (fam,5,100),(fam,4,90),(fam,3,75),(fam,2,50),(fam,1,0);
  insert into public.audit_log(family_id, actor, action, detail) values (fam, me, 'family_created', null);
  return fam;
end $$;

-- only an admin can make/unmake admins (a parent can't promote themself)
create or replace function public.guard_admin_flag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_admin is distinct from old.is_admin and auth.uid() is not null and not public.is_admin_of(new.family_id) then
    raise exception 'Only an admin can change admins'; end if;
  if new.is_admin and new.role <> 'parent' then raise exception 'Admins must be parents'; end if;
  return new;
end $$;
drop trigger if exists members_admin_guard on public.members;
create trigger members_admin_guard before update of is_admin, role on public.members for each row execute function public.guard_admin_flag();

-- ---------- scoreboard visibility ----------
alter table public.settings add column if not exists board_visibility text not null default 'everyone';
alter table public.members add column if not exists board_access text not null default 'default';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_board_visibility') then
    alter table public.settings add constraint settings_board_visibility check (board_visibility in ('everyone','parents')); end if;
  if not exists (select 1 from pg_constraint where conname = 'members_board_access') then
    alter table public.members add constraint members_board_access check (board_access in ('default','allow','deny')); end if;
end $$;

-- Parents always see. A child: 'deny' → never, 'allow' → always, otherwise the family setting decides.
create or replace function public.board_visible() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when m.role = 'parent' then true
                               when m.board_access = 'deny' then false
                               when m.board_access = 'allow' then true
                               else s.board_visibility = 'everyone' end
                   from public.members m join public.settings s on s.family_id = m.family_id
                   where m.user_id = auth.uid() and m.active limit 1), false) $$;

-- leaderboard: same as 006, plus the visibility check
create or replace function public.leaderboard(period text default 'week')
returns table(member_id uuid, display_name text, emoji text, jobs_done integer, tasks_done integer,
              earned_cents integer, points integer, rank integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare fam uuid := public.my_family(); st public.settings; since timestamptz;
begin
  if fam is null or not public.board_visible() then return; end if;
  select * into st from public.settings where family_id = fam;
  since := case period
    when 'week' then (current_date - ((extract(dow from current_date)::int - st.week_start + 7) % 7))::timestamptz
    when 'month' then date_trunc('month', now())
    else '-infinity'::timestamptz end;
  return query
  with s as (
    select sc.member_id as mid, count(*)::int as jobs,
           coalesce(sum((select count(*) from jsonb_object_keys(sc.task_scores))), 0)::int as tasks,
           coalesce(sum(sc.pay_cents), 0)::int as money,
           coalesce(sum((select sum(v::int) from jsonb_each_text(sc.task_scores) as e(k, v))), 0)::int as pts
    from public.scores sc where sc.family_id = fam and sc.scored_at >= since group by sc.member_id
  ), b as (
    select m.id, m.display_name, m.emoji, coalesce(s.jobs, 0) as jobs, coalesce(s.tasks, 0) as tasks,
           coalesce(s.money, 0) as money, coalesce(s.pts, 0) as pts
    from public.members m left join s on s.mid = m.id
    where m.family_id = fam and m.active and (m.role = 'child' or st.board_parents)
  )
  select b.id, b.display_name, b.emoji, b.jobs, b.tasks, b.money, b.pts,
         (rank() over (order by case st.board_rank_by when 'jobs' then b.jobs when 'money' then b.money else b.pts end desc))::int
  from b order by 8, b.display_name;
end $$;
revoke all on function public.board_visible(), public.is_admin_of(uuid) from public, anon;
grant execute on function public.board_visible(), public.is_admin_of(uuid) to authenticated;

-- children may not change their own scoreboard access (members update is parent-only already; this is belt and braces)

-- ---------- parent-to-parent assignments and events (children can never see these) ----------
create table if not exists public.parent_tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null default 'task' check (kind in ('task','event')),
  title text not null check (char_length(title) between 1 and 80),
  details text check (char_length(details) <= 500),
  starts_at timestamptz,
  due_at timestamptz,
  assigned_by uuid not null references public.members(id) on delete cascade,
  assigned_to uuid not null references public.members(id) on delete cascade,
  reward_type text not null default 'none' check (reward_type in ('none','money','gift','other')),
  reward_cents integer check (reward_cents is null or reward_cents between 0 and 1000000),
  reward_note text check (char_length(reward_note) <= 120),
  status text not null default 'assigned' check (status in ('assigned','accepted','declined','done','confirmed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.parent_tasks enable row level security;
revoke all on public.parent_tasks from anon, authenticated;
grant select, insert, update, delete on public.parent_tasks to authenticated;
drop policy if exists pt_read on public.parent_tasks; drop policy if exists pt_insert on public.parent_tasks;
drop policy if exists pt_update on public.parent_tasks; drop policy if exists pt_delete on public.parent_tasks;
create policy pt_read on public.parent_tasks for select to authenticated using (public.is_parent_of(family_id));
create policy pt_insert on public.parent_tasks for insert to authenticated with check (
  public.is_parent_of(family_id) and assigned_by = public.my_member()
  and exists (select 1 from public.members m where m.id = assigned_to and m.family_id = parent_tasks.family_id and m.role = 'parent'));
create policy pt_update on public.parent_tasks for update to authenticated
  using (public.is_parent_of(family_id) and (assigned_by = public.my_member() or assigned_to = public.my_member()))
  with check (public.is_parent_of(family_id) and exists (select 1 from public.members m where m.id = assigned_to and m.family_id = parent_tasks.family_id and m.role = 'parent'));
create policy pt_delete on public.parent_tasks for delete to authenticated using (assigned_by = public.my_member());

-- ---------- autopilot settings, price limits, price history ----------
alter table public.settings add column if not exists autopilot jsonb not null default
  '{"rotation":"auto","reassign":"auto","scoring":"suggest","pricing":"suggest","reminders":"auto"}';
alter table public.settings add column if not exists price_step_percent smallint not null default 10;
alter table public.jobs add column if not exists min_pay_cents integer;
alter table public.jobs add column if not exists max_pay_cents integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_price_bounds') then
    alter table public.jobs add constraint jobs_price_bounds check (
      (min_pay_cents is null or min_pay_cents >= 0) and (max_pay_cents is null or max_pay_cents <= 100000)
      and (min_pay_cents is null or max_pay_cents is null or min_pay_cents <= max_pay_cents)); end if;
end $$;

create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  old_cents integer not null,
  new_cents integer not null,
  source text not null check (source in ('parent','autopilot')),
  reason text check (char_length(reason) <= 200),
  changed_by uuid references public.members(id) on delete set null,
  at timestamptz not null default now()
);
alter table public.price_history enable row level security;
revoke all on public.price_history from anon, authenticated;
grant select on public.price_history to authenticated;
drop policy if exists ph_read on public.price_history;
create policy ph_read on public.price_history for select to authenticated using (public.is_member_of(family_id));

-- every price change is recorded (parents in the app, or the autopilot with a reason)
create or replace function public.track_price() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pay_cents is distinct from old.pay_cents then
    insert into public.price_history(family_id, job_id, old_cents, new_cents, source, reason, changed_by)
    values (new.family_id, new.id, old.pay_cents, new.pay_cents,
            case when auth.uid() is null then 'autopilot' else 'parent' end,
            nullif(current_setting('fc.price_reason', true), ''), public.my_member());
  end if;
  return new;
end $$;
drop trigger if exists jobs_price_history on public.jobs;
create trigger jobs_price_history after update of pay_cents on public.jobs for each row execute function public.track_price();

-- ---------- tests ----------
do $test$
declare fa uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  u_pa uuid := gen_random_uuid(); u_pb uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid(); u_c2 uuid := gen_random_uuid(); j uuid := gen_random_uuid();
  n int; ok boolean; vis boolean; passed int := 0;
begin
  insert into public.families(id, name) values (fa, 'TEST family P');
  insert into public.settings(family_id) values (fa);
  insert into public.members(id, family_id, user_id, display_name, role, age_group, is_admin) values
    (pa, fa, u_pa, 'TestAdminP', 'parent', 'adult', true), (pb, fa, u_pb, 'TestParentP', 'parent', 'adult', false),
    (c1, fa, u_c1, 'TestChildP1', 'child', 'teen', false), (c2, fa, u_c2, 'TestChildP2', 'child', 'kid', false);
  insert into public.jobs(id, family_id, name, pay_cents) values (j, fa, 'Test job P', 200);

  -- parent B assigns parent A an event with a private gift reward
  perform set_config('request.jwt.claims', json_build_object('sub', u_pb, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.parent_tasks(family_id, kind, title, assigned_by, assigned_to, reward_type, reward_note)
    values (fa, 'event', 'Test PTA meeting', pb, pa, 'gift', 'Test reward'); passed := passed + 1;
  ok := false; begin insert into public.parent_tasks(family_id, title, assigned_by, assigned_to) values (fa, 'Bad', pb, c1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a parent task was assigned to a child'; end if; passed := passed + 1;
  ok := false; begin update public.members set is_admin = true where id = pb; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-admin parent made themself admin'; end if; passed := passed + 1;
  update public.jobs set pay_cents = 250 where id = j; passed := passed + 1;
  execute 'reset role';

  -- children can't see parent tasks at all, and can't add them
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.parent_tasks; if n <> 0 then raise exception 'FAIL: a child sees parent tasks'; end if; passed := passed + 1;
  ok := false; begin insert into public.parent_tasks(family_id, title, assigned_by, assigned_to) values (fa, 'x', c1, pa); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child created a parent task'; end if; passed := passed + 1;
  select count(*) into n from public.price_history where job_id = j and source = 'parent' and old_cents = 200 and new_cents = 250;
  if n <> 1 then raise exception 'FAIL: price change not tracked'; end if; passed := passed + 1;
  vis := public.board_visible(); if not vis then raise exception 'FAIL: board hidden by default'; end if; passed := passed + 1;
  execute 'reset role';

  -- admin hides the board from children, then allows one child back
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.settings set board_visibility = 'parents' where family_id = fa;
  update public.members set board_access = 'allow' where id = c2;
  select count(*) into n from public.parent_tasks; if n <> 1 then raise exception 'FAIL: assigned parent cannot see their event'; end if; passed := passed + 1;
  update public.members set is_admin = true where id = pb; passed := passed + 1;   -- admin can promote
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.board_visible() then raise exception 'FAIL: hidden board still visible to a child'; end if; passed := passed + 1;
  select count(*) into n from public.leaderboard('all'); if n <> 0 then raise exception 'FAIL: hidden board returned rows'; end if; passed := passed + 1;
  update public.members set board_access = 'allow' where id = c1; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a child changed their own board access'; end if; passed := passed + 1;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not public.board_visible() then raise exception 'FAIL: allowed child cannot see the board'; end if; passed := passed + 1;
  select count(*) into n from public.leaderboard('all'); if n <> 2 then raise exception 'FAIL: allowed child sees % rows', n; end if; passed := passed + 1;
  execute 'reset role';

  delete from public.families where id = fa;
  raise notice 'ALL % ROLE/VISIBILITY/PARENT-TASK TESTS PASSED', passed;
end $test$;

select 'Admin, scoreboard visibility, parent tasks, autopilot settings and price history installed; ALL TESTS PASSED (test data removed)' as result;
