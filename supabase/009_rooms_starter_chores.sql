-- Family Chores 009: rooms, whole-room claims (bonus / steeper penalty), private home details,
-- parent projects, and a one-time "load starter chores" for the admin.
-- Room value = sum of its weekly chore pay + the whole-room bonus ($10 or $20).
-- Run after 001–008. Safe to re-run. Ends with its own tests (test data removed).

-- ---------- private home details (parents only; admin edits) ----------
create table if not exists public.home_profile (
  family_id uuid primary key references public.families(id) on delete cascade,
  address text check (char_length(address) <= 200),
  floor_area_sqft integer check (floor_area_sqft is null or floor_area_sqft between 100 and 50000),
  bedrooms smallint check (bedrooms is null or bedrooms between 0 and 30),
  bathrooms numeric(3,1) check (bathrooms is null or bathrooms between 0 and 30),
  floors smallint check (floors is null or floors between 1 and 10),
  notes text check (char_length(notes) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.home_profile enable row level security;
revoke all on public.home_profile from anon, authenticated;
grant select, insert, update on public.home_profile to authenticated;
drop policy if exists hp_read on public.home_profile; drop policy if exists hp_write on public.home_profile; drop policy if exists hp_update on public.home_profile;
create policy hp_read on public.home_profile for select to authenticated using (public.is_parent_of(family_id));
create policy hp_write on public.home_profile for insert to authenticated with check (public.is_admin_of(family_id));
create policy hp_update on public.home_profile for update to authenticated using (public.is_admin_of(family_id)) with check (public.is_admin_of(family_id));

-- ---------- rooms ----------
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null default '🏠' check (char_length(emoji) <= 8),
  weekly_value_cents integer not null default 0 check (weekly_value_cents between 0 and 100000),
  whole_bonus_cents integer not null default 1000 check (whole_bonus_cents between 0 and 100000),
  whole_penalty_cents integer not null default 1500 check (whole_penalty_cents between 0 and 100000),
  size_sqft integer check (size_sqft is null or size_sqft between 1 and 20000),
  owner_member uuid references public.members(id) on delete set null,   -- e.g. a child's own bedroom
  position integer not null default 0,
  active boolean not null default true
);
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
grant select, insert, update, delete on public.rooms to authenticated;
drop policy if exists rooms_read on public.rooms; drop policy if exists rooms_write on public.rooms;
create policy rooms_read on public.rooms for select to authenticated using (public.is_member_of(family_id));
create policy rooms_write on public.rooms for all to authenticated using (public.is_parent_of(family_id)) with check (public.is_parent_of(family_id));

alter table public.jobs add column if not exists room_id uuid references public.rooms(id) on delete set null;
alter table public.jobs add column if not exists is_project boolean not null default false;   -- one-off/occasional, outside the room's weekly value

-- weekly pay of a chore = pay per time × times per week
create or replace function public.weekly_cents(j public.jobs) returns numeric
language sql immutable as $$
  select case j.freq when 'daily' then j.pay_cents * 7.0 when 'weekly' then j.pay_cents * 1.0 else j.pay_cents * 7.0 / greatest(j.every_n, 1) end $$;

-- ---------- whole-room claims ----------
create table if not exists public.room_claims (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  week_start date not null,
  member_id uuid not null references public.members(id) on delete cascade,
  source text not null default 'picked' check (source in ('picked','assigned','autopilot')),
  status text not null default 'active' check (status in ('active','completed','missed','cancelled')),
  bonus_cents integer not null,
  penalty_cents integer not null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, week_start)
);
alter table public.room_claims enable row level security;
revoke all on public.room_claims from anon, authenticated;
grant select on public.room_claims to authenticated;
drop policy if exists rc_read on public.room_claims;
create policy rc_read on public.room_claims for select to authenticated using (public.is_member_of(family_id));

-- Claim (child/parent picks) or assign (parent) a whole room for a week. Bonus/penalty are fixed at claim time.
create or replace function public.claim_room(room uuid, week date, member uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; who uuid; me public.members; c uuid; src text;
begin
  select * into r from public.rooms where id = room and active;
  if r.id is null or not public.is_member_of(r.family_id) then raise exception 'Not found'; end if;
  select * into me from public.members where id = public.my_member();
  if me.role = 'caregiver' then raise exception 'Caregivers can''t claim rooms'; end if;
  if r.whole_bonus_cents = 0 then raise exception 'This room''s chores are done one at a time'; end if;
  who := coalesce(member, me.id);
  if who <> me.id and not public.is_parent_of(r.family_id) then raise exception 'Only a parent can assign a room to someone else'; end if;
  if not exists (select 1 from public.members where id = who and family_id = r.family_id and role in ('child','parent')) then raise exception 'Not in this family'; end if;
  src := case when who = me.id then 'picked' else 'assigned' end;
  insert into public.room_claims(family_id, room_id, week_start, member_id, source, bonus_cents, penalty_cents)
    values (r.family_id, room, week, who, src, r.whole_bonus_cents, r.whole_penalty_cents) returning id into c;
  perform public.log(r.family_id, 'room_claimed', jsonb_build_object('room', room, 'week', week, 'member', who, 'source', src));
  return c;
exception when unique_violation then raise exception 'Someone already has this room this week';
end $$;

-- Settle a claim: every non-project chore in the room approved for that week → bonus (as a score-free credit),
-- otherwise the whole-room penalty. Run by the autopilot at week end, or by a parent.
create or replace function public.settle_room_claim(claim uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.room_claims; total int; done int; result text;
begin
  select * into c from public.room_claims where id = claim;
  if c.id is null or c.status <> 'active' then raise exception 'Nothing to settle'; end if;
  if auth.uid() is not null and not public.is_parent_of(c.family_id) then raise exception 'Only a parent can do this'; end if;
  select count(*) into total from public.jobs j where j.room_id = c.room_id and j.active and not j.is_project;
  select count(distinct s.job_id) into done from public.submissions s join public.jobs j on j.id = s.job_id
    where j.room_id = c.room_id and not j.is_project and s.member_id = c.member_id and s.status = 'approved'
      and s.occ between c.week_start and c.week_start + 6;
  if total > 0 and done >= total then
    insert into public.bonuses(family_id, member_id, amount_cents, reason, room_claim)
      values (c.family_id, c.member_id, c.bonus_cents, 'Whole-room bonus', c.id);
    result := 'completed';
  else
    insert into public.penalties(family_id, member_id, amount_cents, reason)
      values (c.family_id, c.member_id, greatest(c.penalty_cents, 1), 'Whole room not completed');
    result := 'missed';
  end if;
  update public.room_claims set status = result, settled_at = now() where id = claim;
  perform public.log(c.family_id, 'room_' || result, jsonb_build_object('claim', claim));
  return result;
end $$;

-- bonuses (whole-room and future autopilot rewards): own or parent read; written by functions
create table if not exists public.bonuses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  amount_cents integer not null check (amount_cents between 1 and 100000),
  reason text not null check (char_length(reason) <= 120),
  room_claim uuid references public.room_claims(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.bonuses enable row level security;
revoke all on public.bonuses from anon, authenticated;
grant select on public.bonuses to authenticated;
drop policy if exists bon_read on public.bonuses;
create policy bon_read on public.bonuses for select to authenticated using (member_id = public.my_member() or public.is_parent_of(family_id));

-- balance now includes bonuses
create or replace function public.balance(member uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when member = public.my_member() or public.is_parent_of((select family_id from public.members where id = member)) then
    coalesce((select sum(pay_cents) from public.scores where member_id = member), 0)
  + coalesce((select sum(amount_cents) from public.bonuses where member_id = member), 0)
  - coalesce((select sum(amount_cents) from public.penalties where member_id = member), 0)
  - coalesce((select sum(amount_cents) from public.payouts where member_id = member), 0)
  else null end $$;

revoke all on function public.claim_room(uuid,date,uuid), public.settle_room_claim(uuid) from public, anon;
grant execute on function public.claim_room(uuid,date,uuid), public.settle_room_claim(uuid) to authenticated;

-- ---------- starter chores (admin, once) ----------
-- Each line: room, emoji, bonus $, then chores: name, emoji, how often, $ per time, youngest age, parents too, kind,
-- then 2 checklist items with "what a 5 looks like".
create or replace function public.load_starter_chores() returns text
language plpgsql security definer set search_path = '' as $$
declare fam uuid := public.my_family(); rid uuid; jid uuid; r jsonb; c jsonb; t jsonb; pos int := 0; jpos int; nrooms int := 0; njobs int := 0; m record;
  spec jsonb := $j$[
  {"room":"Kitchen","emoji":"🍳","bonus":1500,"chores":[
    {"n":"Wash the dishes","e":"🍽️","f":"daily","p":300,"a":"kid","t":[["Dishes washed and racked","Every dish clean, no food left"],["Sink and drain cleared","Sink empty, wiped, drain clear"]]},
    {"n":"Wipe counters and stovetop","e":"🧽","f":"daily","p":100,"a":"kid","t":[["Counters wiped","No crumbs or sticky spots"],["Stovetop wiped","No spills or splatters"]]},
    {"n":"Sweep and mop the floor","e":"🧹","f":"weekly","p":600,"a":"kid","t":[["Swept","Corners and under the table done"],["Mopped","Whole floor mopped, no streaks"]]},
    {"n":"Clean microwave and appliance fronts","e":"✨","f":"weekly","p":400,"a":"kid","t":[["Microwave inside","No splatters inside"],["Fronts and handles","Fridge, oven and dishwasher fronts wiped"]]},
    {"n":"Empty trash and recycling","e":"🗑️","f":"every","every":3,"p":150,"a":"kid","t":[["Bags out","Taken to the outside bins"],["New bags in","Fresh bags fitted"]]},
    {"n":"Clean out the fridge","e":"🧊","f":"weekly","p":350,"a":"teen","t":[["Old food out","Expired food thrown away"],["Shelves wiped","Spills wiped"]]}]},
  {"room":"Living room","emoji":"🛋️","bonus":1000,"chores":[
    {"n":"Tidy and put things away","e":"🧸","f":"daily","p":100,"a":"little","t":[["Toys and things away","Nothing left on the floor"],["Cushions and blankets","Cushions straight, blankets folded"]]},
    {"n":"Vacuum","e":"🌀","f":"weekly","p":500,"a":"kid","t":[["Open floor","Whole floor vacuumed"],["Edges and under furniture","Corners and under the sofa"]]},
    {"n":"Dust surfaces","e":"🪶","f":"weekly","p":400,"a":"kid","t":[["Tables and shelves","No dust left"],["TV stand and electronics","Dusted gently"]]},
    {"n":"Clean windows and glass doors","e":"🪟","f":"weekly","p":400,"a":"kid","t":[["Glass","No smudges"],["Sills and tracks","Wiped clean"]]}]},
  {"room":"Main bathroom","emoji":"🛁","bonus":1000,"chores":[
    {"n":"Clean the toilet","e":"🚽","f":"weekly","p":800,"a":"teen","t":[["Bowl","Scrubbed, no marks"],["Seat, lid and base","Wiped and disinfected"]]},
    {"n":"Scrub the tub and shower","e":"🚿","f":"weekly","p":1000,"a":"teen","t":[["Tub or tray","No soap scum or rings"],["Walls and fixtures","Tiles and taps clean"]]},
    {"n":"Sink, mirror and counter","e":"🪞","f":"weekly","p":600,"a":"kid","t":[["Sink","No toothpaste or hair"],["Mirror","No spots or streaks"]]},
    {"n":"Mop the floor","e":"🧹","f":"weekly","p":400,"a":"kid","t":[["Swept first","Hair and dust gone"],["Mopped","Behind the toilet too"]]},
    {"n":"Restock toilet paper and towels","e":"🧻","f":"weekly","p":200,"a":"little","t":[["Toilet paper","Spare roll in place"],["Towels","Clean towels hung"]]}]},
  {"room":"Hallway and entry","emoji":"🚪","bonus":1000,"chores":[
    {"n":"Tidy the hallway and shoes","e":"👟","f":"weekly","p":300,"a":"little","t":[["Shoes paired","Shoes paired on the rack"],["Floor clear","Nothing left in the way"]]},
    {"n":"Sweep and mop the hallway","e":"🧹","f":"weekly","p":400,"a":"kid","t":[["Swept","Whole length swept"],["Mopped","No marks"]]},
    {"n":"Wipe switches, doors and handrails","e":"🧼","f":"weekly","p":300,"a":"kid","t":[["Switches and handles","No fingerprints"],["Doors and rails","Wiped down"]]},
    {"n":"Paint the hallway walls","e":"🎨","f":"every","every":30,"p":0,"a":"adult","parents":true,"project":true,"t":[["Prep","Taped and covered"],["Paint","Even coats, clean edges"]]}]},
  {"room":"Laundry","emoji":"🧺","bonus":1000,"chores":[
    {"n":"Wash and dry the family loads","e":"🫧","f":"weekly","p":800,"a":"teen","t":[["Sorted","Lights and darks apart"],["Washed and dried","Nothing left damp"]]},
    {"n":"Fold and put away","e":"👕","f":"weekly","p":800,"a":"kid","t":[["Folded","Neatly folded"],["Put away","Back in the right rooms"]]},
    {"n":"Wipe machines and sweep","e":"🧽","f":"weekly","p":400,"a":"kid","t":[["Machines","Lint trap empty, tops wiped"],["Floor","Swept"]]}]},
  {"room":"Dining room","emoji":"🍴","bonus":1000,"chores":[
    {"n":"Set the table","e":"🍽️","f":"daily","p":50,"a":"little","t":[["Places set","Plate, cup and cutlery for everyone"],["Ready on time","Done before dinner"]]},
    {"n":"Clear and wipe the table","e":"🧽","f":"daily","p":50,"a":"little","t":[["Cleared","Dishes to the kitchen"],["Wiped","No crumbs or spills"]]},
    {"n":"Sweep under the table","e":"🧹","f":"weekly","p":300,"a":"kid","t":[["Under the table","No crumbs"],["Chairs","Pushed back in"]]}]},
  {"room":"Yard and outside","emoji":"🌳","bonus":2000,"chores":[
    {"n":"Mow the lawn","e":"🌱","f":"weekly","p":1500,"a":"teen","t":[["Mowed","Even, no missed strips"],["Edges and clippings","Edges trimmed, clippings bagged"]]},
    {"n":"Pull weeds","e":"🌿","f":"weekly","p":500,"a":"kid","t":[["Beds","Weeds out by the root"],["Bagged","Weeds bagged"]]},
    {"n":"Sweep porch and walkway","e":"🧹","f":"weekly","p":400,"a":"kid","t":[["Porch","Swept clear"],["Walkway","Leaves and dirt gone"]]},
    {"n":"Water the plants","e":"💧","f":"weekly","p":200,"a":"little","t":[["Plants","Every plant watered"],["Hose","Put away"]]},
    {"n":"Bins to the curb and back","e":"🗑️","f":"weekly","p":400,"a":"kid","t":[["Out","Out the night before"],["Back","Brought back the same day"]]}]},
  {"room":"Garage","emoji":"🚗","bonus":1000,"chores":[
    {"n":"Sweep the garage","e":"🧹","f":"weekly","p":600,"a":"kid","t":[["Floor","Swept edge to edge"],["Dust pile","Bagged and out"]]},
    {"n":"Organize the shelves","e":"📦","f":"weekly","p":800,"a":"teen","t":[["Sorted","Like things together"],["Labeled","Boxes labeled"]]},
    {"n":"Break down boxes and recycling","e":"♻️","f":"weekly","p":600,"a":"kid","t":[["Boxes","Flattened"],["Recycling","Out in the bin"]]}]},
  {"room":"Getting ready","emoji":"🪥","bonus":0,"chores":[
    {"n":"Brush teeth","e":"🪥","f":"daily","p":25,"a":"little","personal":true,"t":[["Morning","Two minutes, all teeth"],["Night","Two minutes, all teeth"]]},
    {"n":"Brush or comb hair","e":"💇","f":"daily","p":25,"a":"little","personal":true,"t":[["No tangles","Brushed through"],["Neat","Ready for the day"]]},
    {"n":"Dress for the weather","e":"🧥","f":"daily","p":25,"a":"little","personal":true,"t":[["Clean clothes","Clean outfit on"],["Right for the weather","Coat/hat if cold, light if hot"]]}]}
  ]$j$;
begin
  if fam is null or not public.is_admin_of(fam) then raise exception 'Only an admin can load starter chores'; end if;
  if exists (select 1 from public.rooms where family_id = fam) then raise exception 'Rooms already exist: starter chores are only loaded once'; end if;
  for r in select * from jsonb_array_elements(spec) loop
    pos := pos + 1; jpos := 0;
    insert into public.rooms(family_id, name, emoji, whole_bonus_cents, whole_penalty_cents, position)
      values (fam, r->>'room', r->>'emoji', (r->>'bonus')::int, round((r->>'bonus')::int * 1.5), pos) returning id into rid;
    nrooms := nrooms + 1;
    for c in select * from jsonb_array_elements(r->'chores') loop
      jpos := jpos + 1;
      insert into public.jobs(family_id, room_id, name, emoji, kind, pay_cents, freq, every_n, rotate, min_age, parents_in, is_project, position,
                              min_pay_cents, max_pay_cents)
        values (fam, rid, c->>'n', c->>'e', case when (c->>'personal')::boolean then 'personal' else 'work' end, (c->>'p')::int, c->>'f',
                coalesce((c->>'every')::int, 3), case when (c->>'project')::boolean then 'open' else 'weekly' end, c->>'a',
                coalesce((c->>'parents')::boolean, false), coalesce((c->>'project')::boolean, false), jpos,
                round((c->>'p')::int * 0.5), round((c->>'p')::int * 2))
        returning id into jid;
      njobs := njobs + 1;
      insert into public.tasks(job_id, family_id, name, standard_5, standard_3, standard_1, position)
        select jid, fam, x->>0, x->>1, 'Mostly done, a few spots missed', 'Not really done', ord::int
        from jsonb_array_elements(c->'t') with ordinality as e(x, ord);
    end loop;
    -- room value = its weekly chore pay (projects excluded) + the whole-room bonus
    update public.rooms set weekly_value_cents = round((select coalesce(sum(public.weekly_cents(j)), 0) from public.jobs j where j.room_id = rid and not j.is_project)) + whole_bonus_cents
      where id = rid;
  end loop;
  -- one bedroom per child (their own room: fixed to them)
  for m in select id, display_name from public.members where family_id = fam and role = 'child' and active and status = 'active' and not is_guest loop
    pos := pos + 1;
    insert into public.rooms(family_id, name, emoji, whole_bonus_cents, whole_penalty_cents, owner_member, position)
      values (fam, left(m.display_name || '''s bedroom', 40), '🛏️', 1000, 1500, m.id, pos) returning id into rid;
    nrooms := nrooms + 1;
    insert into public.jobs(family_id, room_id, name, emoji, pay_cents, freq, rotate, fixed_member, min_age, position, min_pay_cents, max_pay_cents) values
      (fam, rid, 'Make the bed', '🛏️', 50, 'daily', 'fixed', m.id, 'little', 1, 25, 100),
      (fam, rid, 'Pick up the floor and put things away', '🧸', 50, 'daily', 'fixed', m.id, 'little', 2, 25, 100),
      (fam, rid, 'Vacuum the bedroom', '🌀', 300, 'weekly', 'fixed', m.id, 'kid', 3, 150, 600);
    njobs := njobs + 3;
    insert into public.tasks(job_id, family_id, name, standard_5, standard_3, standard_1, position)
      select j.id, fam, 'Done properly', 'Neat and complete', 'Mostly done, a few spots missed', 'Not really done', 1 from public.jobs j where j.room_id = rid;
    update public.rooms set weekly_value_cents = round((select coalesce(sum(public.weekly_cents(j)), 0) from public.jobs j where j.room_id = rid)) + whole_bonus_cents where id = rid;
  end loop;
  perform public.log(fam, 'starter_chores_loaded', jsonb_build_object('rooms', nrooms, 'chores', njobs));
  return nrooms || ' rooms and ' || njobs || ' chores loaded';
end $$;
revoke all on function public.load_starter_chores() from public, anon;
grant execute on function public.load_starter_chores() to authenticated;

-- ---------- tests ----------
do $test$
declare fa uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  u_pa uuid := gen_random_uuid(); u_pb uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid(); u_c2 uuid := gen_random_uuid();
  msg text; n int; v int; ok boolean; kitchen uuid; claim uuid; res text; passed int := 0; wk date := current_date;
begin
  insert into public.families(id, name) values (fa, 'TEST family R');
  insert into public.settings(family_id) values (fa);
  insert into public.members(id, family_id, user_id, display_name, role, age_group, is_admin) values
    (pa, fa, u_pa, 'TestAdminR', 'parent', 'adult', true), (pb, fa, u_pb, 'TestParentR', 'parent', 'adult', false),
    (c1, fa, u_c1, 'TestChildR1', 'child', 'teen', false), (c2, fa, u_c2, 'TestChildR2', 'child', 'little', false);

  perform set_config('request.jwt.claims', json_build_object('sub', u_pb, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.load_starter_chores(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-admin parent loaded starter chores'; end if; passed := passed + 1;
  ok := false; begin insert into public.home_profile(family_id, address) values (fa, 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a non-admin parent wrote the home address'; end if; passed := passed + 1;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  msg := public.load_starter_chores(); passed := passed + 1;
  if msg not like '11 rooms%' then raise exception 'FAIL: %', msg; end if; passed := passed + 1;   -- 9 shared rooms + 2 bedrooms
  ok := false; begin perform public.load_starter_chores(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: starter chores loaded twice'; end if; passed := passed + 1;
  select id, weekly_value_cents into kitchen, v from public.rooms where family_id = fa and name = 'Kitchen';
  if v <> 6000 then raise exception 'FAIL: kitchen weekly value % (want 6000 = 4500 chores + 1500 bonus)', v; end if; passed := passed + 1;
  select count(*) into n from public.rooms where family_id = fa and weekly_value_cents - whole_bonus_cents <= 0 and name <> 'Getting ready';
  if n <> 0 then raise exception 'FAIL: a room has no chore value'; end if; passed := passed + 1;
  select count(*) into n from public.jobs where family_id = fa and kind = 'personal'; if n <> 3 then raise exception 'FAIL: personal-care chores not marked personal'; end if; passed := passed + 1;
  select count(*) into n from public.jobs where family_id = fa and is_project and parents_in and min_age = 'adult'; if n <> 1 then raise exception 'FAIL: parent project missing'; end if; passed := passed + 1;
  select count(*) into n from public.tasks t join public.jobs j on j.id = t.job_id where j.family_id = fa; if n < 60 then raise exception 'FAIL: only % checklist items', n; end if; passed := passed + 1;
  insert into public.home_profile(family_id, address, bedrooms) values (fa, 'TEST address', 4); passed := passed + 1;
  execute 'reset role';

  -- a child sees rooms but not the address; claims the kitchen; can't claim it for someone else
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.home_profile; if n <> 0 then raise exception 'FAIL: a child sees the home address'; end if; passed := passed + 1;
  select count(*) into n from public.rooms; if n <> 11 then raise exception 'FAIL: child sees % rooms', n; end if; passed := passed + 1;
  ok := false; begin perform public.claim_room(kitchen, wk, c2); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child assigned a room to a sibling'; end if; passed := passed + 1;
  claim := public.claim_room(kitchen, wk); passed := passed + 1;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  ok := false; begin perform public.claim_room(kitchen, wk); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: two people claimed the same room'; end if; passed := passed + 1;
  execute 'reset role';

  -- settle: nothing approved → whole-room penalty (1.5 × bonus = 2250); balance reflects it
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  res := public.settle_room_claim(claim); if res <> 'missed' then raise exception 'FAIL: settle gave %', res; end if; passed := passed + 1;
  if public.balance(c1) <> -2250 then raise exception 'FAIL: balance after whole-room penalty %', public.balance(c1); end if; passed := passed + 1;
  execute 'reset role';

  -- all kitchen chores approved → bonus
  update public.room_claims set status = 'active', settled_at = null where id = claim;
  insert into public.submissions(family_id, job_id, member_id, occ, status)
    select fa, j.id, c1, wk, 'approved' from public.jobs j where j.room_id = kitchen and not j.is_project;
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  res := public.settle_room_claim(claim); if res <> 'completed' then raise exception 'FAIL: full room gave %', res; end if; passed := passed + 1;
  select count(*) into n from public.bonuses where member_id = c1 and amount_cents = 1500; if n <> 1 then raise exception 'FAIL: whole-room bonus missing'; end if; passed := passed + 1;
  execute 'reset role';

  delete from public.families where id = fa;
  raise notice 'ALL % ROOM TESTS PASSED', passed;
end $test$;

select 'Rooms, whole-room claims, home profile and starter chores installed; ALL ROOM TESTS PASSED (test data removed)' as result;
