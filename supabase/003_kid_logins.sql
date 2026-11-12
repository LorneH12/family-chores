-- Family Chores: children sign in with a username + password set by a parent (no email).
-- Run after 001. Safe to re-run.
-- Passwords are stored only as bcrypt hashes in a table nobody can read from the app.

create extension if not exists pgcrypto with schema extensions;

alter table public.members add column if not exists username text;
alter table public.members add column if not exists device_restricted boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_username_format') then
    alter table public.members add constraint members_username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_username_key') then
    alter table public.members add constraint members_username_key unique (username);
  end if;
end $$;

alter table public.settings add column if not exists kid_idle_minutes smallint not null default 30;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_kid_idle') then
    alter table public.settings add constraint settings_kid_idle check (kid_idle_minutes between 5 and 240);
  end if;
end $$;

-- Secrets: no grants to app users at all. Only the functions below touch it.
create table if not exists public.member_login (
  member_id uuid primary key references public.members(id) on delete cascade,
  pass_hash text not null,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.member_login enable row level security;
revoke all on public.member_login from anon, authenticated;

-- Optional device restriction: a child can only sign in on devices a parent approved.
create table if not exists public.member_devices (
  member_id uuid not null references public.members(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 16 and 64),
  label text check (char_length(label) <= 30),
  added_at timestamptz not null default now(),
  primary key (member_id, device_id)
);
alter table public.member_devices enable row level security;
revoke all on public.member_devices from anon, authenticated;
grant select, insert, delete on public.member_devices to authenticated;
drop policy if exists dev_read on public.member_devices;
drop policy if exists dev_write on public.member_devices;
drop policy if exists dev_delete on public.member_devices;
create policy dev_read on public.member_devices for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));
create policy dev_write on public.member_devices for insert to authenticated with check (public.is_parent_of(family_id)
  and family_id = (select m.family_id from public.members m where m.id = member_id));
create policy dev_delete on public.member_devices for delete to authenticated using (public.is_parent_of(family_id));

-- Parent sets or resets a child's username + password (6–40 characters).
create or replace function public.set_kid_login(member uuid, uname text, pass text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.members;
begin
  select * into m from public.members where id = member;
  if m.id is null or not public.is_parent_of(m.family_id) then raise exception 'Only a parent can do this'; end if;
  if m.role <> 'child' then raise exception 'Parents sign in with email'; end if;
  if char_length(pass) < 6 or char_length(pass) > 40 then raise exception 'Password must be 6 to 40 characters'; end if;
  update public.members set username = lower(trim(uname)) where id = member;
  insert into public.member_login(member_id, pass_hash) values (member, extensions.crypt(pass, extensions.gen_salt('bf', 10)))
    on conflict (member_id) do update set pass_hash = excluded.pass_hash, failed_attempts = 0, locked_until = null, updated_at = now();
  perform public.log(m.family_id, 'kid_login_set', jsonb_build_object('member', member));
end $$;

-- Parent unlocks a child after too many wrong passwords.
create or replace function public.unlock_kid(member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare fam uuid; begin
  select family_id into fam from public.members where id = member;
  if fam is null or not public.is_parent_of(fam) then raise exception 'Only a parent can do this'; end if;
  update public.member_login set failed_attempts = 0, locked_until = null where member_id = member;
  perform public.log(fam, 'kid_unlocked', jsonb_build_object('member', member));
end $$;

-- Called ONLY by the kid-login server function (service role). Checks password, lockout and device.
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
    if l.failed_attempts + 1 >= 5 then
      insert into public.audit_log(family_id, actor, action, detail) values (m.family_id, m.id, 'kid_locked', null);
    end if;
    return query select null::uuid, null::uuid, null::uuid, 'Wrong username or password'::text; return;
  end if;
  if m.device_restricted and not exists (select 1 from public.member_devices d where d.member_id = m.id and d.device_id = device) then
    return query select null::uuid, null::uuid, null::uuid, 'This device isn''t allowed for your account. Ask a parent.'::text; return;
  end if;
  update public.member_login set failed_attempts = 0, locked_until = null where member_login.member_id = m.id;
  return query select m.id, m.user_id, m.family_id, null::text;
end $$;

-- Called ONLY by the kid-login function after it creates the child's hidden sign-in account.
create or replace function public.link_kid_user(member uuid, uid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.members set user_id = uid where id = member and role = 'child' and user_id is null $$;

revoke all on function public.set_kid_login(uuid,text,text), public.unlock_kid(uuid), public.kid_auth(text,text,text), public.link_kid_user(uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_kid_login(uuid,text,text), public.unlock_kid(uuid) to authenticated;
grant execute on function public.kid_auth(text,text,text), public.link_kid_user(uuid,uuid) to service_role;

select 'Kid logins installed' as result;
