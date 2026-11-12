-- Family Chores: tests for child usernames/passwords, lockout and device restriction.
-- Run after 003. Uses fake test people and removes them. Success = ALL KID LOGIN TESTS PASSED.
do $test$
declare
  fa uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  u_pa uuid := gen_random_uuid(); u_c1 uuid := gen_random_uuid();
  n int; ok boolean; r record; passed int := 0; i int; uname text := 'testkid_' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
begin
  insert into public.families(id, name) values (fa, 'TEST family K');
  insert into public.settings(family_id) values (fa);
  insert into public.members(id, family_id, user_id, display_name, role, age_group) values
    (pa, fa, u_pa, 'TestParentK', 'parent', 'adult'), (c1, fa, u_c1, 'TestKidK1', 'child', 'teen'), (c2, fa, null, 'TestKidK2', 'child', 'kid');

  -- parent sets logins
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_kid_login(c2, uname, 'correct-horse'); passed := passed + 1;
  ok := false; begin perform public.set_kid_login(c2, uname, '123'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a 3-character password was accepted'; end if; passed := passed + 1;
  ok := false; begin perform public.set_kid_login(pa, 'parentname', 'whatever123'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a parent got a username login'; end if; passed := passed + 1;
  ok := false; begin perform count(*) from public.member_login; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: app users can read password hashes'; end if; passed := passed + 1;
  ok := false; begin perform * from public.kid_auth(uname, 'correct-horse', 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: app users can call kid_auth directly'; end if; passed := passed + 1;
  execute 'reset role';

  -- a child cannot set or reset a sibling's password
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false; begin perform public.set_kid_login(c2, uname, 'hacked-pass'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child reset a sibling password'; end if; passed := passed + 1;
  ok := false; begin perform public.unlock_kid(c2); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child unlocked an account'; end if; passed := passed + 1;
  execute 'reset role';

  -- the server function's checks (run as the service role)
  execute 'set local role service_role';
  select * into r from public.kid_auth(upper(uname), 'correct-horse', 'device-aaaaaaaaaaaaaaaa');
  if r.error is not null or r.member_id <> c2 then raise exception 'FAIL: correct password rejected (%)', r.error; end if; passed := passed + 1;
  select * into r from public.kid_auth(uname, 'wrong', 'd'); if r.error is null then raise exception 'FAIL: wrong password accepted'; end if; passed := passed + 1;
  select * into r from public.kid_auth('nobody_here', 'x', 'd'); if r.error <> 'Wrong username or password' then raise exception 'FAIL: unknown user message leaks (%)', r.error; end if; passed := passed + 1;
  for i in 1..5 loop select * into r from public.kid_auth(uname, 'wrong', 'd'); end loop;
  select * into r from public.kid_auth(uname, 'correct-horse', 'd');
  if r.error is null or r.error not like 'Too many tries%' then raise exception 'FAIL: no lockout after 5 wrong tries (%)', r.error; end if; passed := passed + 1;
  execute 'reset role';

  -- parent unlocks and turns on the device restriction
  perform set_config('request.jwt.claims', json_build_object('sub', u_pa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.unlock_kid(c2);
  update public.members set device_restricted = true where id = c2;
  insert into public.member_devices(member_id, family_id, device_id, label) values (c2, fa, 'device-aaaaaaaaaaaaaaaa', 'Kitchen laptop');
  execute 'reset role';
  execute 'set local role service_role';
  select * into r from public.kid_auth(uname, 'correct-horse', 'device-aaaaaaaaaaaaaaaa');
  if r.error is not null then raise exception 'FAIL: approved device rejected (%)', r.error; end if; passed := passed + 1;
  select * into r from public.kid_auth(uname, 'correct-horse', 'device-bbbbbbbbbbbbbbbb');
  if r.error is null then raise exception 'FAIL: unapproved device allowed'; end if; passed := passed + 1;
  execute 'reset role';

  -- a child cannot add their own device
  perform set_config('request.jwt.claims', json_build_object('sub', u_c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false; begin insert into public.member_devices(member_id, family_id, device_id) values (c1, fa, 'device-cccccccccccccccc'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a child approved their own device'; end if; passed := passed + 1;
  execute 'reset role';

  delete from public.families where id = fa;
  raise notice 'ALL % KID LOGIN TESTS PASSED', passed;
end
$test$;
select 'ALL KID LOGIN TESTS PASSED (test data removed)' as result;
