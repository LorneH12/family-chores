-- Family Chores 008: invites and guests (babysitters, visiting cousins/friends, co-parents).
-- Invites can be permanent, temporary (date range) or one-off. Every join needs a parent/admin's approval.
-- Access ends on its own when the window closes. Run after 001–007. Safe to re-run. Ends with tests.

-- ---------- members: status, access window, guest options, caregiver role ----------
alter table public.members add column if not exists status text not null default 'active';
alter table public.members add column if not exists access_from timestamptz;
alter table public.members add column if not exists access_until timestamptz;
alter table public.members add column if not exists is_guest boolean not null default false;
alter table public.members add column if not exists guest_label text;
alter table public.members add column if not exists can_earn boolean not null default true;
alter table public.members add column if not exists show_on_board boolean not null default true;
alter table public.members add column if not exists approved_by uuid references public.members(id) on delete set null;
alter table public.members add column if not exists approved_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_status_check2') then
    alter table public.members add constraint members_status_check2 check (status in ('pending','active','declined','revoked')); end if;
  if exists (select 1 from pg_constraint where conname = 'members_role_check') then
    alter table public.members drop constraint members_role_check; end if;
  if not exists (select 1 from pg_constraint where conname = 'members_role_check2') then
    alter table public.members add constraint members_role_check2 check (role in ('parent','child','caregiver')); end if;
  if not exists (select 1 from pg_constraint where conname = 'members_guest_label_len') then
    alter table public.members add constraint members_guest_label_len check (guest_label is null or char_length(guest_label) <= 40); end if;
  if not exists (select 1 from pg_constraint where conname = 'members_window') then
    alter table public.members add constraint members_window check (access_from is null or access_until is null or access_from < access_until); end if;
end $$;

-- "current" = active, approved, and inside its access window (if any)
create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.members where user_id = auth.uid() and active and status = 'active'
    and (access_from is null or access_from <= now()) and (access_until is null or access_until > now()) limit 1 $$;
create or replace function public.my_member() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = auth.uid() and active and status = 'active'
    and (access_from is null or access_from <= now()) and (access_until is null or access_until > now()) limit 1 $$;
create or replace function public.is_member_of(fam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and status = 'active' and family_id = fam
    and (access_from is null or access_from <= now()) and (access_until is null or access_until > now())) $$;
create or replace function public.is_parent_of(fam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and status = 'active' and role = 'parent' and family_id = fam
    and (access_from is null or access_from <= now()) and (access_until is null or access_until > now())) $$;
create or replace function public.is_admin_of(fam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and status = 'active' and role = 'parent' and is_admin and family_id = fam
    and (access_from is null or access_from <= now()) and (access_until is null or access_until > now())) $$;
create or replace function public.board_visible() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when m.role = 'parent' then true
                               when m.board_access = 'deny' then false
                               when m.board_access = 'allow' then true
                               else s.board_visibility = 'everyone' end
                   from public.members m join public.settings s on s.family_id = m.family_id
                   where m.user_id = auth.uid() and m.active and m.status = 'active'
                     and (m.access_from is null or m.access_from <= now()) and (m.access_until is null or m.access_until > now()) limit 1), false) $$;

-- children sign-in also respects status and window
create or replace function public.kid_auth(uname text, pass text, device text)
returns table(member_id uuid, user_id uuid, family_id uuid, error text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare m public.members; l public.member_login;
begin
  select * into m from public.members where username = lower(trim(uname)) and role = 'child' and active;
  if m.id is null then return query select null::uuid, null::uuid, null::uuid, 'Wrong username or password'::text; return; end if;
  select * into l from public.member_login where member_login.member_id = m.id;
  if l.member_id is null then return query select null::uuid, null::uuid, null::uuid, 'Wrong username or password'::text; return; end if;
  if l.locked_until is not null and l.locked_until > now() then
    return query select null::uuid, null::uuid, null::uuid, 'Too many tries. Ask a parent, or wait 15 minutes.'::text; return; end if;
  if extensions.crypt(pass, l.pass_hash) <> l.pass_hash then
    update public.member_login set failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
      where member_login.member_id = m.id;
    if l.failed_attempts + 1 >= 5 then insert into public.audit_log(family_id, actor, action, detail) values (m.family_id, m.id, 'kid_locked', null); end if;
    return query select null::uuid, null::uuid, null::uuid, 'Wrong username or password'::text; return;
  end if;
  if m.status <> 'active' or (m.access_from is not null and m.access_from > now()) or (m.access_until is not null and m.access_until <= now()) then
    return query select null::uuid, null::uuid, null::uuid, 'Your access isn''t open right now. Ask a parent.'::text; return; end if;
  if m.device_restricted and not exists (select 1 from public.member_devices d where d.member_id = m.id and d.device_id = device) then
    return query select null::uuid, null::uuid, null::uuid, 'This device isn''t allowed for your account. Ask a parent.'::text; return; end if;
  update public.member_login set failed_attempts = 0, locked_until = null where member_login.member_id = m.id;
  return query select m.id, m.user_id, m.family_id, null::text;
end $$;
revoke all on function public.kid_auth(text,text,text) from public, anon, authenticated;
grant execute on function public.kid_auth(text,text,text) to service_role;
-- set_kid_login: visiting children are children too
create or replace function public.set_kid_login(member uuid, uname text, pass text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.members;
begin
  select * into m from public.members where id = member;
  if m.id is null or not public.is_parent_of(m.family_id) then raise exception 'Only a parent can do this'; end if;
  if m.role <> 'child' then raise exception 'Only children use a username login'; end if;
  if char_length(pass) < 6 or char_length(pass) > 40 then raise exception 'Password must be 6 to 40 characters'; end if;
  update public.members set username = lower(trim(uname)) where id = member;
  insert into public.member_login(member_id, pass_hash) values (member, extensions.crypt(pass, extensions.gen_salt('bf', 10)))
    on conflict (member_id) do update set pass_hash = excluded.pass_hash, failed_attempts = 0, locked_until = null, updated_at = now();
  perform public.log(m.family_id, 'kid_login_set', jsonb_build_object('member', member));
end $$;

-- caregivers may see children's submission status (not photos, scores or money) via family_board(); nothing else changes.

-- leaderboard: guests only when show_on_board, and only current members
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
    where m.family_id = fam and m.active and m.status = 'active' and m.show_on_board
      and (m.access_until is null or m.access_until > now())
      and (m.role = 'child' or (m.role = 'parent' and st.board_parents))
  )
  select b.id, b.display_name, b.emoji, b.jobs, b.tasks, b.money, b.pts,
         (rank() over (order by case st.board_rank_by when 'jobs' then b.jobs when 'money' then b.money else b.pts end desc))::int
  from b order by 8, b.display_name;
end $$;

-- ---------- invites ----------
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code_hash text not null unique,
  role text not null check (role in ('parent','caregiver','child')),
  label text not null check (char_length(label) between 1 and 40),
  duration text not null check (duration in ('permanent','temporary','one_off')),
  access_from timestamptz,
  access_until timestamptz,
  can_earn boolean not null default false,
  show_on_board boolean not null default false,
  code_expires_at timestamptz not null,
  uses_left smallint not null default 1 check (uses_left >= 0),
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (duration <> 'permanent' or access_until is null),
  check (duration = 'permanent' or access_until is not null)
);
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
grant select, delete on public.invites to authenticated;
drop policy if exists inv_read on public.invites; drop policy if exists inv_delete on public.invites;
create policy inv_read on public.invites for select to authenticated using (public.is_parent_of(family_id));
create policy inv_delete on public.invites for delete to authenticated using (public.is_parent_of(family_id));

-- A parent/admin creates an invite; returns the code to share (only shown once).
create or replace function public.create_invite(role text, label text, duration text, access_from timestamptz default null,
  access_until timestamptz default null, can_earn boolean default false, show_on_board boolean default false, valid_hours integer default 72)
returns text language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare fam uuid := public.my_family(); code text;
begin
  if fam is null or not public.is_parent_of(fam) then raise exception 'Only a parent can invite'; end if;
  if role = 'parent' and not public.is_admin_of(fam) then raise exception 'Only an admin can invite a parent'; end if;
  if duration = 'permanent' then access_until := null; end if;
  if duration <> 'permanent' and access_until is null then raise exception 'Temporary and one-off invites need an end date'; end if;
  if valid_hours < 1 or valid_hours > 720 then raise exception 'Invite must be valid for 1 to 720 hours'; end if;
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites(family_id, code_hash, role, label, duration, access_from, access_until, can_earn, show_on_board, code_expires_at, uses_left, created_by)
  values (fam, encode(sha256(convert_to(code, 'UTF8')), 'hex'), role, label, duration, access_from, access_until, can_earn, show_on_board,
          now() + make_interval(hours => valid_hours), 1, public.my_member());
  perform public.log(fam, 'invite_created', jsonb_build_object('role', role, 'label', label, 'duration', duration));
  return code;
end $$;

-- The invited person (signed in with email) asks to join. Creates a PENDING member: they see nothing until approved.
create or replace function public.request_join(code text, my_name text, my_emoji text default '🙂') returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.invites; mid uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Sign in with email first'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'This account is already in a family'; end if;
  select * into i from public.invites where code_hash = encode(sha256(convert_to(upper(trim(code)), 'UTF8')), 'hex')
    and uses_left > 0 and code_expires_at > now() for update;
  if i.id is null then raise exception 'Code not valid or expired'; end if;
  update public.invites set uses_left = uses_left - 1 where id = i.id;
  insert into public.members(family_id, user_id, display_name, emoji, role, age_group, status, is_guest, guest_label,
                             access_from, access_until, can_earn, show_on_board)
  values (i.family_id, auth.uid(), left(my_name, 24), left(coalesce(my_emoji, '🙂'), 8), i.role,
          case when i.role = 'child' then 'kid' else 'adult' end, 'pending', i.role <> 'parent', i.label,
          i.access_from, i.access_until, i.can_earn, i.show_on_board)
  returning id into mid;
  insert into public.audit_log(family_id, actor, action, detail) values (i.family_id, mid, 'join_requested', jsonb_build_object('label', i.label, 'role', i.role));
  return mid;
end $$;

-- A parent/admin approves (optionally changing role/window) or declines. Parent roles need an admin.
create or replace function public.decide_member(member uuid, approve boolean, new_role text default null,
  new_from timestamptz default null, new_until timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.members; r text;
begin
  select * into m from public.members where id = member;
  if m.id is null or not public.is_parent_of(m.family_id) then raise exception 'Only a parent can do this'; end if;
  if m.status <> 'pending' then raise exception 'This request was already decided'; end if;
  r := coalesce(new_role, m.role);
  if r not in ('parent','caregiver','child') then raise exception 'Unknown role'; end if;
  if r = 'parent' and not public.is_admin_of(m.family_id) then raise exception 'Only an admin can approve a parent'; end if;
  if approve then
    update public.members set status = 'active', role = r, is_guest = (r <> 'parent'),
      access_from = coalesce(new_from, access_from), access_until = case when r = 'parent' and new_until is null then null else coalesce(new_until, access_until) end,
      approved_by = public.my_member(), approved_at = now() where id = member;
  else
    update public.members set status = 'declined', user_id = null where id = member;
  end if;
  perform public.log(m.family_id, case when approve then 'join_approved' else 'join_declined' end, jsonb_build_object('member', member, 'role', r));
end $$;

-- Revoke access now (keeps their history).
create or replace function public.revoke_member(member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.members; begin
  select * into m from public.members where id = member;
  if m.id is null or not public.is_parent_of(m.family_id) then raise exception 'Only a parent can do this'; end if;
  if m.id = public.my_member() then raise exception 'You can''t revoke yourself'; end if;
  if m.role = 'parent' and not public.is_admin_of(m.family_id) then raise exception 'Only an admin can revoke a parent'; end if;
  update public.members set status = 'revoked', access_until = now() where id = member;
  perform public.log(m.family_id, 'access_revoked', jsonb_build_object('member', member));
end $$;

-- What a signed-in person sees about themselves (works while pending/expired, so the app can explain).
create or replace function public.my_status() returns table(member_id uuid, status text, role text, access_from timestamptz, access_until timestamptz, label text)
language sql stable security definer set search_path = '' as $$
  select id, status, role, access_from, access_until, guest_label from public.members where user_id = auth.uid() limit 1 $$;

revoke all on function public.create_invite(text,text,text,timestamptz,timestamptz,boolean,boolean,integer), public.request_join(text,text,text),
  public.decide_member(uuid,boolean,text,timestamptz,timestamptz), public.revoke_member(uuid), public.my_status() from public, anon;
grant execute on function public.create_invite(text,text,text,timestamptz,timestamptz,boolean,boolean,integer), public.request_join(text,text,text),
  public.decide_member(uuid,boolean,text,timestamptz,timestamptz), public.revoke_member(uuid), public.my_status() to authenticated;

-- members table: parents read pending requests too (they're in the family); a pending/expired person reads nothing (is_member_of is false).

-- ---------- tests ----------
do $test$
declare fa uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  u_pa uuid := gen_random_uuid(); u_pb uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid(); u_sit uuid := gen_random_uuid(); u_x uuid := gen_random_uuid();
  j uuid := gen_random_uuid(); sit uuid; code text; n int; ok boolean; passed int := 0;
begin
  insert into public.families(id, name) values (fa, 'TEST family G');
  insert into public.settings(family_id) values (fa);
  insert into public.members(id, family_id, user_id, display_name, role, age_group, is_admin) values
    (pa, fa, u_pa, 'TestAdminG', 'parent', 'adult', true), (pb, fa, u_pb, 'TestParentG', 'parent', 'adult', false), (c1, fa, u_c1, 'TestChildG', 'child', 'kid', false);
  insert into public.jobs(id, family_id, name, pay_cents) values (j, fa, 'Test job G', 200);
  insert into public.penalties(family_id, member_id, amount_cents, reason, created_by) values (fa, c1, 50, 'Test', pa);
  insert into public.parent_tasks(family_id, title, assigned_by, assigned_to) values (fa, 'Test parent task', pa, pb);

  -- a child can't invite; a non-admin parent can't invite a parent; a parent invites a one-off babysitter
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.create_invite('caregiver', 'Sitter', 'one_off', now(), now() + interval '6 hours'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child created an invite'; end if; passed := passed + 1;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_pb, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.create_invite('parent', 'Co-parent', 'permanent'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-admin parent invited a parent'; end if; passed := passed + 1;
  ok := false; begin perform public.create_invite('caregiver', 'Sitter', 'temporary'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a temporary invite without an end date was accepted'; end if; passed := passed + 1;
  code := public.create_invite('caregiver', 'Babysitter Sat', 'one_off', now() - interval '1 minute', now() + interval '6 hours'); passed := passed + 1;
  execute 'reset role';

  -- the babysitter requests; while pending they see nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u_sit, 'role', 'authenticated', 'is_anonymous', false)::text, true); execute 'set local role authenticated';
  sit := public.request_join(lower(code), 'TestSitter'); passed := passed + 1;
  select count(*) into n from public.members; if n <> 0 then raise exception 'FAIL: pending guest sees members'; end if; passed := passed + 1;
  select count(*) into n from public.my_status() where status = 'pending'; if n <> 1 then raise exception 'FAIL: pending guest cannot see own status'; end if; passed := passed + 1;
  execute 'reset role';
  -- the code is one-off: a second person can't use it
  perform set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated', 'is_anonymous', false)::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.request_join(code, 'Someone'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a one-off invite worked twice'; end if; passed := passed + 1;
  execute 'reset role';

  -- a child can't approve; the parent approves
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.decide_member(sit, true); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child approved a guest'; end if; passed := passed + 1;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_pb, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.members where status = 'pending'; if n <> 1 then raise exception 'FAIL: parent cannot see the pending request'; end if; passed := passed + 1;
  ok := false; begin perform public.decide_member(sit, true, 'parent'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-admin parent approved someone as a parent'; end if; passed := passed + 1;
  perform public.decide_member(sit, true); passed := passed + 1;
  execute 'reset role';

  -- the approved babysitter sees chores and people, but no money, scores, penalties or parent tasks
  perform set_config('request.jwt.claims', json_build_object('sub', u_sit, 'role', 'authenticated', 'is_anonymous', false)::text, true); execute 'set local role authenticated';
  select count(*) into n from public.jobs; if n <> 1 then raise exception 'FAIL: approved caregiver cannot see jobs'; end if; passed := passed + 1;
  select count(*) into n from public.penalties; if n <> 0 then raise exception 'FAIL: caregiver sees penalties'; end if; passed := passed + 1;
  select count(*) into n from public.parent_tasks; if n <> 0 then raise exception 'FAIL: caregiver sees parent tasks'; end if; passed := passed + 1;
  select count(*) into n from public.member_payout; if n <> 0 then raise exception 'FAIL: caregiver sees payout details'; end if; passed := passed + 1;
  if public.balance(c1) is not null then raise exception 'FAIL: caregiver sees a child balance'; end if; passed := passed + 1;
  ok := false; begin perform public.create_invite('caregiver', 'x', 'permanent'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a caregiver created an invite'; end if; passed := passed + 1;
  execute 'reset role';

  -- when the window closes, access ends by itself
  update public.members set access_until = now() - interval '1 minute' where id = sit;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sit, 'role', 'authenticated', 'is_anonymous', false)::text, true); execute 'set local role authenticated';
  select count(*) into n from public.jobs; if n <> 0 then raise exception 'FAIL: expired guest still sees jobs'; end if; passed := passed + 1;
  execute 'reset role';

  -- a non-admin parent can't revoke the admin; the admin can revoke a guest
  update public.members set access_until = now() + interval '1 hour' where id = sit;
  perform set_config('request.jwt.claims', json_build_object('sub', u_pb, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.revoke_member(pa); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-admin parent revoked the admin'; end if; passed := passed + 1;
  perform public.revoke_member(sit); passed := passed + 1;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_sit, 'role', 'authenticated', 'is_anonymous', false)::text, true); execute 'set local role authenticated';
  select count(*) into n from public.members; if n <> 0 then raise exception 'FAIL: revoked guest still sees the family'; end if; passed := passed + 1;
  execute 'reset role';

  delete from public.families where id = fa;
  raise notice 'ALL % INVITE/GUEST TESTS PASSED', passed;
end $test$;

select 'Invites and guests installed; ALL INVITE/GUEST TESTS PASSED (test data removed)' as result;
