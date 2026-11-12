-- Family Chores: database, security rules ("firewall") and private photo storage.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: it only creates what is missing and replaces functions/policies.
-- No personal data in this file: names are entered by a parent inside the app.

-- ============================================================
-- 1. TABLES
-- ============================================================
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);

-- People in a family. user_id = the signed-in account on that person's phone (null until paired).
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid unique,
  display_name text not null check (char_length(display_name) between 1 and 24),
  emoji text not null default '🙂' check (char_length(emoji) <= 8),
  role text not null check (role in ('parent','child')),
  age_group text not null default 'kid' check (age_group in ('little','kid','teen','adult')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists members_family on public.members(family_id);

-- Payout details are private: only the person and parents can see them (siblings can't).
create table if not exists public.member_payout (
  member_id uuid primary key references public.members(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  default_method text not null default 'cash' check (default_method in ('cash','cashapp','bank','mix','other')),
  cashtag text check (cashtag is null or cashtag ~ '^\$[A-Za-z][A-Za-z0-9_]{0,19}$'),
  bank_note text check (char_length(bank_note) <= 60),   -- a nickname like "Savings ...42", never full account numbers
  mix jsonb,                                              -- e.g. {"cash":50,"cashapp":50}
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  family_id uuid primary key references public.families(id) on delete cascade,
  week_start smallint not null default 0 check (week_start in (0,1)),
  rotation_start date not null default current_date,
  approve_swaps boolean not null default true,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null default 'America/New_York',
  personal_photo_days smallint not null default 7 check (personal_photo_days between 1 and 90)
);

-- Pay scale: job rating (rounded 1–5) → % of the job's pay.
create table if not exists public.pay_scale (
  family_id uuid not null references public.families(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  percent smallint not null check (percent between 0 and 200),
  primary key (family_id, score)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null default '✨' check (char_length(emoji) <= 8),
  kind text not null default 'work' check (kind in ('work','personal')),  -- personal = photo may show the child: never cloud AI
  pay_cents integer not null default 100 check (pay_cents between 0 and 100000),
  freq text not null default 'weekly' check (freq in ('daily','weekly','every')),
  every_n smallint not null default 3 check (every_n between 2 and 30),
  rotate text not null default 'weekly' check (rotate in ('daily','weekly','every','fixed','open')),
  rot_every smallint not null default 3 check (rot_every between 2 and 30),
  fixed_member uuid references public.members(id) on delete set null,
  min_age text not null default 'kid' check (min_age in ('little','kid','teen','adult')),
  parents_in boolean not null default false,
  payout_method text check (payout_method in ('cash','cashapp','bank','mix','other')),  -- null = person's default
  active boolean not null default true,
  position integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists jobs_family on public.jobs(family_id);

-- Tasks inside a job, each with a visible standard (the rubric).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  standard_5 text check (char_length(standard_5) <= 200),
  standard_3 text check (char_length(standard_3) <= 200),
  standard_1 text check (char_length(standard_1) <= 200),
  weight numeric(4,2) not null default 1 check (weight > 0 and weight <= 10),
  position integer not null default 0
);
create index if not exists tasks_job on public.tasks(job_id);

create table if not exists public.swaps (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  occ date not null,
  from_member uuid not null references public.members(id) on delete cascade,
  to_member uuid not null references public.members(id) on delete cascade,
  status text not null default 'asked' check (status in ('asked','accepted','declined','approved','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists swaps_family on public.swaps(family_id, occ);

-- A child's proof that a job was done.
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  occ date not null,
  completed_on date not null default current_date,
  tasks_done uuid[] not null default '{}',
  before_path text,
  after_path text,
  note text check (char_length(note) <= 200),
  status text not null default 'submitted' check (status in ('submitted','ai_scored','approved','rejected')),
  ai_suggestion jsonb,            -- written only by the server-side AI function
  created_at timestamptz not null default now(),
  unique (job_id, occ, member_id)
);
create index if not exists submissions_family on public.submissions(family_id, occ);

-- Parent-approved scores (the matrix the child sees).
create table if not exists public.scores (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  task_scores jsonb not null,     -- {"<task_id>": 1..5}
  job_rating numeric(3,2) not null check (job_rating between 1 and 5),
  base_cents integer not null,
  percent smallint not null,
  pay_cents integer not null check (pay_cents >= 0),
  feedback text check (char_length(feedback) <= 600),
  ai_used boolean not null default false,
  scored_by uuid references public.members(id) on delete set null,
  scored_at timestamptz not null default now()
);

create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  amount_cents integer not null check (amount_cents between 1 and 100000),
  reason text not null check (char_length(reason) between 1 and 120),
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  method text not null check (method in ('cash','cashapp','bank','other')),
  covers uuid[] not null default '{}',   -- submission ids paid by this payout
  note text check (char_length(note) <= 120),
  status text not null default 'sent' check (status in ('sent','received')),
  paid_by uuid references public.members(id) on delete set null,
  paid_at timestamptz not null default now(),
  received_at timestamptz
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  actor uuid,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);

create table if not exists public.pairing_codes (
  code_hash text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ============================================================
-- 2. WHO AM I (helpers used by the rules; run as owner so they can read members)
-- ============================================================
create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.members where user_id = auth.uid() and active limit 1 $$;

create or replace function public.my_member() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = auth.uid() and active limit 1 $$;

create or replace function public.is_parent_of(fam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'parent' and family_id = fam) $$;

create or replace function public.is_member_of(fam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and family_id = fam) $$;

-- ============================================================
-- 3. ROW-LEVEL SECURITY (the firewall)
-- Children: see the family's people, jobs, tasks, rubric and swaps; see ONLY their own
-- submissions, scores, penalties, payouts and payout details. Parents: everything in their family.
-- Nobody sees another family. Anonymous visitors see nothing.
-- ============================================================
do $$ declare t text; begin
  foreach t in array array['families','members','member_payout','settings','pay_scale','jobs','tasks','swaps','submissions','scores','penalties','payouts','audit_log','pairing_codes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- drop old policies so re-running stays clean
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- families
grant select, update on public.families to authenticated;
create policy fam_read on public.families for select to authenticated using (public.is_member_of(id));
create policy fam_update on public.families for update to authenticated using (public.is_parent_of(id)) with check (public.is_parent_of(id));

-- members (names/emoji/role/age group are family-visible; payout details are not here)
grant select, insert, update, delete on public.members to authenticated;
create policy mem_read on public.members for select to authenticated using (public.is_member_of(family_id));
create policy mem_insert on public.members for insert to authenticated with check (public.is_parent_of(family_id) and user_id is null);
create policy mem_update on public.members for update to authenticated using (public.is_parent_of(family_id)) with check (public.is_parent_of(family_id));
create policy mem_delete on public.members for delete to authenticated using (public.is_parent_of(family_id) and id <> public.my_member());

-- member_payout: self or parent
grant select, insert, update, delete on public.member_payout to authenticated;
create policy pay_read on public.member_payout for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));
create policy pay_write on public.member_payout for all to authenticated using (public.is_parent_of(family_id)) with check (public.is_parent_of(family_id) and family_id = (select m.family_id from public.members m where m.id = member_id));

-- family-wide reference data: everyone in the family reads, parents write
grant select, insert, update, delete on public.settings, public.pay_scale, public.jobs, public.tasks to authenticated;
create policy set_read on public.settings for select to authenticated using (public.is_member_of(family_id));
create policy set_write on public.settings for all to authenticated using (public.is_parent_of(family_id)) with check (public.is_parent_of(family_id));
create policy scale_read on public.pay_scale for select to authenticated using (public.is_member_of(family_id));
create policy scale_write on public.pay_scale for all to authenticated using (public.is_parent_of(family_id)) with check (public.is_parent_of(family_id));
create policy jobs_read on public.jobs for select to authenticated using (public.is_member_of(family_id));
create policy jobs_write on public.jobs for all to authenticated using (public.is_parent_of(family_id)) with check (public.is_parent_of(family_id));
create policy tasks_read on public.tasks for select to authenticated using (public.is_member_of(family_id));
create policy tasks_write on public.tasks for all to authenticated
  using (public.is_parent_of(family_id))
  with check (public.is_parent_of(family_id) and family_id = (select j.family_id from public.jobs j where j.id = job_id));

-- swaps: family reads (the board); a person asks for themselves; changes go through respond_swap()
grant select, insert on public.swaps to authenticated;
create policy swaps_read on public.swaps for select to authenticated using (public.is_member_of(family_id));
create policy swaps_insert on public.swaps for insert to authenticated with check (
  public.is_member_of(family_id) and from_member = public.my_member() and to_member <> from_member and status = 'asked'
  and family_id = (select m.family_id from public.members m where m.id = to_member)
  and family_id = (select j.family_id from public.jobs j where j.id = job_id));

-- submissions: own or parent; a child creates their own, may edit until it's scored; parents decide
grant select, insert, update, delete on public.submissions to authenticated;
create policy sub_read on public.submissions for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));
create policy sub_insert on public.submissions for insert to authenticated with check (
  member_id = public.my_member() and family_id = public.my_family() and status = 'submitted' and ai_suggestion is null
  and family_id = (select j.family_id from public.jobs j where j.id = job_id));
create policy sub_update_own on public.submissions for update to authenticated
  using (member_id = public.my_member() and status = 'submitted')
  with check (member_id = public.my_member() and status = 'submitted' and ai_suggestion is null);
create policy sub_parent on public.submissions for all to authenticated using (public.is_parent_of(family_id)) with check (public.is_parent_of(family_id));

-- scores / penalties / payouts: own or parent can read; only parents write (via functions for scores/receipts)
grant select on public.scores to authenticated;
create policy scores_read on public.scores for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));
grant select, insert, delete on public.penalties to authenticated;
create policy pen_read on public.penalties for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));
create policy pen_write on public.penalties for insert to authenticated with check (public.is_parent_of(family_id) and created_by = public.my_member()
  and family_id = (select m.family_id from public.members m where m.id = member_id));
create policy pen_delete on public.penalties for delete to authenticated using (public.is_parent_of(family_id));
grant select, insert on public.payouts to authenticated;
create policy po_read on public.payouts for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));
create policy po_insert on public.payouts for insert to authenticated with check (public.is_parent_of(family_id) and paid_by = public.my_member() and status = 'sent'
  and family_id = (select m.family_id from public.members m where m.id = member_id));

-- audit log: parents read; written by functions/triggers only
grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated using (public.is_parent_of(family_id));
-- pairing_codes: no direct access at all (functions only)

-- ============================================================
-- 4. FUNCTIONS (safe actions; each checks who is calling)
-- ============================================================
create or replace function public.log(fam uuid, act text, det jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log(family_id, actor, action, detail) values (fam, public.my_member(), act, det) $$;

-- First parent creates the family. Only works when the project has no family yet (one family per project).
create or replace function public.create_family(family_name text, my_name text, my_emoji text default '🧑')
returns uuid language plpgsql security definer set search_path = '' as $$
declare fam uuid; me uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Sign in with email first'; end if;
  if exists (select 1 from public.families) then raise exception 'This app already has a family'; end if;
  insert into public.families(name) values (family_name) returning id into fam;
  insert into public.members(family_id, user_id, display_name, emoji, role, age_group) values (fam, auth.uid(), my_name, my_emoji, 'parent', 'adult') returning id into me;
  insert into public.settings(family_id) values (fam);
  insert into public.pay_scale(family_id, score, percent) values (fam,5,100),(fam,4,90),(fam,3,75),(fam,2,50),(fam,1,0);
  insert into public.audit_log(family_id, actor, action, detail) values (fam, me, 'family_created', null);
  return fam;
end $$;

-- A parent makes a one-time code (valid 30 minutes) to pair a person's phone.
create or replace function public.create_pairing(member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare fam uuid; code text;
begin
  select family_id into fam from public.members where id = member;
  if fam is null or not public.is_parent_of(fam) then raise exception 'Only a parent can do this'; end if;
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  delete from public.pairing_codes where member_id = member;
  insert into public.pairing_codes(code_hash, family_id, member_id, expires_at)
    values (encode(sha256(convert_to(code, 'UTF8')), 'hex'), fam, member, now() + interval '30 minutes');
  perform public.log(fam, 'pairing_created', jsonb_build_object('member', member));
  return code;
end $$;

-- The phone redeems the code. Children may use an anonymous sign-in; parents must be signed in with email.
create or replace function public.redeem_pairing(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pc public.pairing_codes; m public.members;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into pc from public.pairing_codes
   where code_hash = encode(sha256(convert_to(upper(trim(code)), 'UTF8')), 'hex') and used_at is null and expires_at > now();
  if pc.code_hash is null then raise exception 'Code not valid or expired'; end if;
  select * into m from public.members where id = pc.member_id;
  if m.role = 'parent' and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Parents sign in with email first'; end if;
  if exists (select 1 from public.members where user_id = auth.uid() and id <> m.id) then raise exception 'This phone is already paired to someone else'; end if;
  update public.members set user_id = auth.uid() where id = m.id;
  update public.pairing_codes set used_at = now() where code_hash = pc.code_hash;
  insert into public.audit_log(family_id, actor, action, detail) values (m.family_id, m.id, 'paired', null);
  return m.id;
end $$;

-- A parent un-pairs a lost phone.
create or replace function public.unpair(member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare fam uuid; begin
  select family_id into fam from public.members where id = member;
  if fam is null or not public.is_parent_of(fam) then raise exception 'Only a parent can do this'; end if;
  update public.members set user_id = null where id = member;
  perform public.log(fam, 'unpaired', jsonb_build_object('member', member));
end $$;

-- Swap responses: the asked person accepts/declines; the asker cancels; a parent approves/declines.
create or replace function public.respond_swap(swap uuid, action text) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.swaps; me uuid := public.my_member(); parent boolean; need_approval boolean; new_status text;
begin
  select * into s from public.swaps where id = swap;
  if s.id is null or not public.is_member_of(s.family_id) then raise exception 'Not found'; end if;
  parent := public.is_parent_of(s.family_id);
  select approve_swaps into need_approval from public.settings where family_id = s.family_id;
  if action = 'accept' and s.status = 'asked' and s.to_member = me then new_status := case when need_approval then 'accepted' else 'approved' end;
  elsif action = 'decline' and s.status in ('asked','accepted') and (s.to_member = me or parent) then new_status := 'declined';
  elsif action = 'cancel' and s.status in ('asked','accepted') and s.from_member = me then new_status := 'cancelled';
  elsif action = 'approve' and s.status = 'accepted' and parent then new_status := 'approved';
  else raise exception 'Not allowed'; end if;
  update public.swaps set status = new_status, updated_at = now() where id = swap;
  perform public.log(s.family_id, 'swap_' || action, jsonb_build_object('swap', swap));
  return new_status;
end $$;

-- A parent approves the scores (their own, or edited AI suggestions). Pay is computed here, not on the phone.
create or replace function public.approve_scores(sub uuid, task_scores jsonb, feedback text default null, ai_used boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare s public.submissions; j public.jobs; total numeric := 0; wsum numeric := 0; t record; sc int; rating numeric; pct int; pay int;
begin
  select * into s from public.submissions where id = sub;
  if s.id is null or not public.is_parent_of(s.family_id) then raise exception 'Only a parent can do this'; end if;
  select * into j from public.jobs where id = s.job_id;
  for t in select id, weight from public.tasks where job_id = s.job_id loop
    sc := (task_scores ->> t.id::text)::int;
    if sc is null or sc < 1 or sc > 5 then raise exception 'Every task needs a score from 1 to 5'; end if;
    total := total + sc * t.weight; wsum := wsum + t.weight;
  end loop;
  if wsum = 0 then raise exception 'This job has no tasks'; end if;
  rating := round(total / wsum, 2);
  select percent into pct from public.pay_scale where family_id = s.family_id and score = round(rating)::int;
  pay := round(j.pay_cents * coalesce(pct, 0) / 100.0);
  insert into public.scores(submission_id, family_id, member_id, task_scores, job_rating, base_cents, percent, pay_cents, feedback, ai_used, scored_by)
    values (sub, s.family_id, s.member_id, task_scores, rating, j.pay_cents, coalesce(pct, 0), pay, feedback, ai_used, public.my_member())
    on conflict (submission_id) do update set task_scores = excluded.task_scores, job_rating = excluded.job_rating, base_cents = excluded.base_cents,
      percent = excluded.percent, pay_cents = excluded.pay_cents, feedback = excluded.feedback, ai_used = excluded.ai_used, scored_by = excluded.scored_by, scored_at = now();
  update public.submissions set status = 'approved' where id = sub;
  perform public.log(s.family_id, 'scores_approved', jsonb_build_object('submission', sub, 'rating', rating, 'pay_cents', pay));
  return pay;
end $$;

-- The child confirms they received a payout (closes cash invoices too).
create or replace function public.confirm_received(payout uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payouts; begin
  select * into p from public.payouts where id = payout;
  if p.id is null or p.member_id <> public.my_member() then raise exception 'Not allowed'; end if;
  update public.payouts set status = 'received', received_at = now() where id = payout;
  perform public.log(p.family_id, 'payout_received', jsonb_build_object('payout', payout));
end $$;

-- Family board: who has submitted what, without photos, scores or money (safe for siblings to see).
create or replace function public.family_board(from_day date, to_day date)
returns table(job_id uuid, occ date, member_id uuid, status text)
language sql stable security definer set search_path = '' as $$
  select s.job_id, s.occ, s.member_id, s.status from public.submissions s
  where s.family_id = public.my_family() and s.occ between from_day and to_day $$;

-- Balance for one person (self or parent): approved pay − penalties − payouts.
create or replace function public.balance(member uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when member = public.my_member() or public.is_parent_of((select family_id from public.members where id = member)) then
    coalesce((select sum(pay_cents) from public.scores where member_id = member), 0)
  - coalesce((select sum(amount_cents) from public.penalties where member_id = member), 0)
  - coalesce((select sum(amount_cents) from public.payouts where member_id = member), 0)
  else null end $$;

-- Audit triggers for money-related changes made directly through the rules above.
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  if not exists (select 1 from public.families where id = (r ->> 'family_id')::uuid) then  -- family being deleted: nothing to log
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  insert into public.audit_log(family_id, actor, action, detail)
  values ((r ->> 'family_id')::uuid, public.my_member(), tg_table_name || '_' || lower(tg_op),
          case when tg_table_name = 'jobs' then jsonb_build_object('job', r ->> 'id', 'pay_cents', r -> 'pay_cents')
               else jsonb_build_object('id', r ->> 'id', 'amount_cents', r -> 'amount_cents') end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists audit_jobs on public.jobs;
create trigger audit_jobs after insert or update of pay_cents or delete on public.jobs for each row execute function public.audit_trigger();
drop trigger if exists audit_penalties on public.penalties;
create trigger audit_penalties after insert or delete on public.penalties for each row execute function public.audit_trigger();
drop trigger if exists audit_payouts on public.payouts;
create trigger audit_payouts after insert on public.payouts for each row execute function public.audit_trigger();

-- Function permissions: signed-in users only; helpers are not callable by anonymous visitors.
do $$ declare f text; begin
  foreach f in array array['my_family()','my_member()','is_parent_of(uuid)','is_member_of(uuid)','log(uuid,text,jsonb)','audit_trigger()',
    'create_family(text,text,text)','create_pairing(uuid)','redeem_pairing(text)','unpair(uuid)','respond_swap(uuid,text)',
    'approve_scores(uuid,jsonb,text,boolean)','confirm_received(uuid)','family_board(date,date)','balance(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
end $$;
grant execute on function public.my_family(), public.my_member(), public.is_parent_of(uuid), public.is_member_of(uuid),
  public.create_family(text,text,text), public.create_pairing(uuid), public.redeem_pairing(text), public.unpair(uuid),
  public.respond_swap(uuid,text), public.approve_scores(uuid,jsonb,text,boolean), public.confirm_received(uuid),
  public.family_board(date,date), public.balance(uuid) to authenticated;

-- ============================================================
-- 5. PRIVATE PHOTO STORAGE
-- Path: <family_id>/<member_id>/<submission_id>/before.jpg|after.jpg
-- Readable by that person and parents only. Siblings and outsiders can't. Max 5 MB, JPEG/WebP only.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 5242880, array['image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/webp'];

drop policy if exists proofs_read on storage.objects;
drop policy if exists proofs_insert on storage.objects;
drop policy if exists proofs_update on storage.objects;
drop policy if exists proofs_delete on storage.objects;
create policy proofs_read on storage.objects for select to authenticated using (
  bucket_id = 'proofs' and (
    (storage.foldername(name))[2] = public.my_member()::text
    or exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'parent'
               and m.family_id::text = (storage.foldername(name))[1])));
create policy proofs_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'proofs'
  and (storage.foldername(name))[1] = public.my_family()::text
  and (storage.foldername(name))[2] = public.my_member()::text);
create policy proofs_update on storage.objects for update to authenticated using (
  bucket_id = 'proofs' and (storage.foldername(name))[2] = public.my_member()::text)
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = public.my_family()::text and (storage.foldername(name))[2] = public.my_member()::text);
create policy proofs_delete on storage.objects for delete to authenticated using (
  bucket_id = 'proofs' and exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'parent'
               and m.family_id::text = (storage.foldername(name))[1]));

select 'Family Chores schema installed' as result;
