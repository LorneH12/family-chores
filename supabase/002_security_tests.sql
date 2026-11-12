-- Family Chores: security tests. Run AFTER 001_schema.sql, BEFORE adding real family data.
-- It creates two fake test families, acts as each person, tries to break the rules,
-- then deletes everything it made. (Photo-storage rules are tested separately through the real upload API.) Success = the last line says ALL SECURITY TESTS PASSED.
-- Any failure stops with "FAIL: …" and nothing is left behind (the whole test rolls back).

do $test$
declare
  fa uuid := gen_random_uuid(); fb uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  c3 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  u_pa uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid(); u_c2 uuid := gen_random_uuid(); u_pb uuid := gen_random_uuid();
  u_anon uuid := gen_random_uuid(); u_anon2 uuid := gen_random_uuid();
  ja uuid := gen_random_uuid(); jb uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); sw uuid;
  n int; ok boolean; code text; pay int; st text; passed int := 0;
begin
  -- ---------- test data (as the database owner, rules not applied) ----------
  insert into public.families(id, name) values (fa, 'TEST family A'), (fb, 'TEST family B');
  insert into public.settings(family_id) values (fa), (fb);
  insert into public.pay_scale(family_id, score, percent) select f, s, p from (values (fa),(fb)) v(f), (values (5,100),(4,90),(3,75),(2,50),(1,0)) x(s,p);
  insert into public.members(id, family_id, user_id, display_name, role, age_group) values
    (pa, fa, u_pa, 'TestParentA', 'parent', 'adult'), (c1, fa, u_c1, 'TestKid1', 'child', 'teen'),
    (c2, fa, u_c2, 'TestKid2', 'child', 'kid'), (pb, fb, u_pb, 'TestParentB', 'parent', 'adult'),
    (c3, fa, null, 'TestKid3', 'child', 'little'), (p2, fa, null, 'TestParent2', 'parent', 'adult');
  insert into public.member_payout(member_id, family_id, default_method, cashtag) values (c1, fa, 'cashapp', '$TestKidOne'), (c2, fa, 'cash', null);
  insert into public.jobs(id, family_id, name, pay_cents) values (ja, fa, 'Test job A', 400), (jb, fb, 'Test job B', 100);
  insert into public.tasks(id, job_id, family_id, name, weight) values (t1, ja, fa, 'Task one', 1), (t2, ja, fa, 'Task two', 1);
  insert into public.submissions(id, family_id, job_id, member_id, occ, before_path, after_path) values
    (s1, fa, ja, c1, current_date, fa || '/' || c1 || '/x/before.jpg', fa || '/' || c1 || '/x/after.jpg'),
    (s2, fa, ja, c2, current_date - 7, null, null);
  insert into public.scores(submission_id, family_id, member_id, task_scores, job_rating, base_cents, percent, pay_cents)
    values (s1, fa, c1, jsonb_build_object(t1::text, 5, t2::text, 5), 5, 400, 100, 400);
  insert into public.payouts(family_id, member_id, amount_cents, method, paid_by) values (fa, c1, 100, 'cashapp', pa);
  insert into public.penalties(family_id, member_id, amount_cents, reason, created_by) values (fa, c2, 25, 'Test penalty', pa);


  -- ===== Child 1 =====
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.families; if n <> 1 then raise exception 'FAIL: child sees % families (want 1)', n; end if; passed := passed + 1;
  select count(*) into n from public.members; if n <> 5 then raise exception 'FAIL: child sees % members (want 5, own family only)', n; end if; passed := passed + 1;
  select count(*) into n from public.submissions; if n <> 1 then raise exception 'FAIL: child sees % submissions (want only own = 1)', n; end if; passed := passed + 1;
  select count(*) into n from public.scores; if n <> 1 then raise exception 'FAIL: child sees % scores (want own = 1)', n; end if; passed := passed + 1;
  select count(*) into n from public.penalties; if n <> 0 then raise exception 'FAIL: child sees a sibling penalty'; end if; passed := passed + 1;
  select count(*) into n from public.member_payout; if n <> 1 then raise exception 'FAIL: child sees % payout profiles (want own = 1)', n; end if; passed := passed + 1;
  select count(*) into n from public.jobs; if n <> 1 then raise exception 'FAIL: child sees other family jobs'; end if; passed := passed + 1;
  select count(*) into n from public.audit_log; if n <> 0 then raise exception 'FAIL: child can read the audit log'; end if; passed := passed + 1;
  if public.balance(c2) is not null then raise exception 'FAIL: child can read a sibling balance'; end if; passed := passed + 1;
  if public.balance(c1) <> 300 then raise exception 'FAIL: own balance % (want 300)', public.balance(c1); end if; passed := passed + 1;
  select count(*) into n from public.family_board(current_date - 14, current_date); if n <> 2 then raise exception 'FAIL: family board shows % (want 2 statuses)', n; end if; passed := passed + 1;

  update public.jobs set pay_cents = 99999 where id = ja; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: child changed a job price'; end if; passed := passed + 1;
  ok := false; begin insert into public.jobs(family_id, name) values (fa, 'Sneaky job'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: child created a job'; end if; passed := passed + 1;
  ok := false; begin insert into public.submissions(family_id, job_id, member_id, occ) values (fa, ja, c2, current_date); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: child submitted for a sibling'; end if; passed := passed + 1;
  ok := false; begin insert into public.submissions(family_id, job_id, member_id, occ, ai_suggestion) values (fa, ja, c1, current_date - 1, '{"score":5}'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: child wrote their own AI score'; end if; passed := passed + 1;
  insert into public.submissions(family_id, job_id, member_id, occ) values (fa, ja, c1, current_date - 1); passed := passed + 1;  -- own submission works
  ok := false; begin perform public.approve_scores(s1, jsonb_build_object(t1::text, 5, t2::text, 5)); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: child approved scores'; end if; passed := passed + 1;
  ok := false; begin insert into public.payouts(family_id, member_id, amount_cents, method, paid_by) values (fa, c1, 5000, 'cash', c1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: child recorded a payout'; end if; passed := passed + 1;
  update public.members set role = 'parent' where id = c1; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: child made themself a parent'; end if; passed := passed + 1;
  ok := false; begin perform public.create_family('Another', 'Me'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a second family could be created'; end if; passed := passed + 1;
  insert into public.swaps(family_id, job_id, occ, from_member, to_member) values (fa, ja, current_date, c1, c2) returning id into sw; passed := passed + 1;
  ok := false; begin perform public.respond_swap(sw, 'approve'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: child approved a swap'; end if; passed := passed + 1;
  execute 'reset role';

  -- ===== Child 2 accepts the swap =====
  perform set_config('request.jwt.claims', json_build_object('sub', u_c2, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  st := public.respond_swap(sw, 'accept'); if st <> 'accepted' then raise exception 'FAIL: accept gave %', st; end if; passed := passed + 1;
  select count(*) into n from public.payouts; if n <> 0 then raise exception 'FAIL: sibling sees child 1 payouts'; end if; passed := passed + 1;
  execute 'reset role';

  -- ===== Parent A =====
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.submissions; if n <> 3 then raise exception 'FAIL: parent sees % submissions (want 3)', n; end if; passed := passed + 1;
  st := public.respond_swap(sw, 'approve'); if st <> 'approved' then raise exception 'FAIL: parent approve gave %', st; end if; passed := passed + 1;
  pay := public.approve_scores(s2, jsonb_build_object(t1::text, 5, t2::text, 3), 'Good effort'); -- rating 4 → 90% of 400
  if pay <> 360 then raise exception 'FAIL: pay % (want 360)', pay; end if; passed := passed + 1;
  ok := false; begin perform public.approve_scores(s2, jsonb_build_object(t1::text, 6, t2::text, 3)); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a score of 6 was accepted'; end if; passed := passed + 1;
  update public.jobs set pay_cents = 500 where id = ja; get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: parent could not change a price'; end if; passed := passed + 1;
  select count(*) into n from public.audit_log where action = 'jobs_update'; if n < 1 then raise exception 'FAIL: price change not in audit log'; end if; passed := passed + 1;
  select count(*) into n from public.members where family_id = fb; if n <> 0 then raise exception 'FAIL: parent A sees family B'; end if; passed := passed + 1;
  code := public.create_pairing(c3); passed := passed + 1;
  execute 'reset role';

  -- ===== Unpaired anonymous phone sees nothing, then pairs with the code =====
  perform set_config('request.jwt.claims', json_build_object('sub', u_anon, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.members; if n <> 0 then raise exception 'FAIL: unpaired phone sees % members', n; end if; passed := passed + 1;
  select count(*) into n from public.jobs; if n <> 0 then raise exception 'FAIL: unpaired phone sees jobs'; end if; passed := passed + 1;
  ok := false; begin perform public.redeem_pairing('WRONGCODE1'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a wrong code paired a phone'; end if; passed := passed + 1;
  perform public.redeem_pairing(lower(code)); passed := passed + 1;
  select count(*) into n from public.members; if n <> 5 then raise exception 'FAIL: paired child sees % members (want 5)', n; end if; passed := passed + 1;
  ok := false; begin perform public.redeem_pairing(code); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a pairing code worked twice'; end if; passed := passed + 1;
  execute 'reset role';

  -- ===== Anonymous phone can't take a parent's code =====
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  code := public.create_pairing(p2);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_anon2, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  execute 'set local role authenticated';
  ok := false; begin perform public.redeem_pairing(code); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: an anonymous phone became a parent'; end if; passed := passed + 1;
  execute 'reset role';

  -- ===== Parent of family B sees nothing of family A =====
  perform set_config('request.jwt.claims', json_build_object('sub', u_pb, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.submissions where family_id = fa; if n <> 0 then raise exception 'FAIL: family B parent sees family A submissions'; end if; passed := passed + 1;
  ok := false; begin perform public.create_pairing(c1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: family B parent made a code for a family A child'; end if; passed := passed + 1;
  execute 'reset role';

  -- ===== Not signed in at all =====
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  ok := false; begin select count(*) into n from public.members; exception when others then ok := true; n := 0; end;
  if n <> 0 then raise exception 'FAIL: a visitor who is not signed in can read members'; end if; passed := passed + 1;
  execute 'reset role';

  -- ---------- clean up ----------
  delete from public.families where id in (fa, fb);
  raise notice 'ALL % SECURITY TESTS PASSED', passed;
end
$test$;

select 'ALL SECURITY TESTS PASSED (test data removed)' as result;
