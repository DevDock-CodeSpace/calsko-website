-- Check for the learning platform (20261101160000_teacher_role, 20261101161000_learning_platform).
--
-- Run it against a LOCAL or rehearsal database (DevDock Dev), never production:
--   psql "<dev or local URL>" -v ON_ERROR_STOP=1 -f supabase/tests/learning_platform.sql
--
-- An academy: an owner, an admin, two teachers, two students and someone outside it. Checks who creates
-- courses, co-teachers, open and invite-only enrollment, course codes (single use, one course, joining
-- the group), who sees which codes and classes, the Learning page's numbers, and role changes.
-- Rolls back; raises listing every failed check, so a clean run means every line held.

begin;

create function pg_temp.run_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_user)::text, true);
    execute 'set local role authenticated';
    execute p_sql into v_out;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return coalesce(v_out, '<null>');
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return 'ERR:' || sqlstate;
  end;
end;
$$;

do $$
declare
  v_owner    uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_teacher  uuid := gen_random_uuid();
  v_teacher2 uuid := gen_random_uuid();
  v_student  uuid := gen_random_uuid();
  v_student2 uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid(); -- not in the group
  v_team     uuid := gen_random_uuid();
  v_fail     text[] := '{}';
  v_checks   integer := 0;
  v_out      text;
  v_course   uuid;   -- teacher's, open
  v_course2  uuid;   -- teacher2's, invite only
  v_module   uuid;
  v_lesson1  uuid;
  v_lesson2  uuid;
  v_code     text;
  v_code2    text;
  v_json     jsonb;
  r          record;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, last_sign_in_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'learn-check-' || u || '@example.test', jsonb_build_object('full_name', 'P ' || left(u::text, 4)), now()
  from unnest(array[v_owner, v_admin, v_teacher, v_teacher2, v_student, v_student2, v_outsider]) as u;
  insert into public.teams (id, name, slug, type, created_by)
  values (v_team, 'Academy check', 'academy-check-' || left(v_team::text, 8), 'learning', v_owner);
  insert into public.team_members (team_id, user_id, role)
  values (v_team, v_owner, 'owner'), (v_team, v_admin, 'admin'), (v_team, v_teacher, 'member'),
         (v_team, v_teacher2, 'member'), (v_team, v_student, 'member'), (v_team, v_student2, 'member')
  on conflict (team_id, user_id) do update set role = excluded.role;

  -- ------------------------------------------------------------------ making teachers
  for r in select * from (values
    ('the admin makes a member a teacher', v_admin, format($q$update public.team_members set role = 'teacher' where team_id = %L and user_id = %L returning role::text$q$, v_team, v_teacher), 'teacher'),
    ('the admin can''t make anyone an admin', v_admin, format($q$update public.team_members set role = 'admin' where team_id = %L and user_id = %L returning role::text$q$, v_team, v_student), 'ERR:42501'),
    ('a teacher can''t change roles', v_teacher, format($q$update public.team_members set role = 'teacher' where team_id = %L and user_id = %L returning role::text$q$, v_team, v_student), '<null>'),
    ('the owner makes a teacher', v_owner, format($q$update public.team_members set role = 'teacher' where team_id = %L and user_id = %L returning role::text$q$, v_team, v_teacher2), 'teacher')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  -- ------------------------------------------------------------------ creating courses
  v_out := pg_temp.run_as(v_student, format($q$select public.create_course(%L, 'Hack', null)::text$q$, v_team));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:42501' then v_fail := v_fail || format('a student can''t create a course: got %s', v_out); end if;

  v_out := pg_temp.run_as(v_teacher, format($q$select public.create_course(%L, '  Web basics ', 'HTML and CSS', 'open')::text$q$, v_team));
  v_checks := v_checks + 1;
  if v_out like 'ERR:%' then v_fail := v_fail || format('a teacher creates a course: got %s', v_out); end if;
  v_course := v_out::uuid;
  select * into r from public.workspaces where id = v_course;
  v_checks := v_checks + 1;
  if r.title <> 'Web basics' or r.type <> 'course' or r.access <> 'members' or r.enrollment <> 'open' then
    v_fail := v_fail || format('the course is enrolled-only and open: got %s', row_to_json(r));
  end if;
  v_checks := v_checks + 1;
  if (select role from public.workspace_members where workspace_id = v_course and user_id = v_teacher) is distinct from 'lead'
     or not exists (select 1 from public.workspace_modules where workspace_id = v_course and module = 'learning') then
    v_fail := v_fail || text 'its creator teaches it and it has the course tools';
  end if;
  v_course2 := pg_temp.run_as(v_teacher2, format($q$select public.create_course(%L, 'Design', null, 'invite')::text$q$, v_team))::uuid;

  -- ------------------------------------------------------------------ co-teachers and teachers' reach
  for r in select * from (values
    ('another teacher can''t manage the course', v_teacher2, format($q$select public.set_course_enrollment(%L, 'invite')::text$q$, v_course), 'ERR:42501'),
    ('a student can''t be made a co-teacher', v_teacher, format($q$select public.set_course_teacher(%L, %L, true)::text$q$, v_course, v_student), 'ERR:22023'),
    ('the teacher adds a co-teacher', v_teacher, format($q$select public.set_course_teacher(%L, %L, true)::text$q$, v_course, v_teacher2), ''),
    ('the co-teacher is removed again', v_teacher, format($q$select public.set_course_teacher(%L, %L, false)::text$q$, v_course, v_teacher2), ''),
    ('a course keeps one teacher', v_teacher, format($q$select public.set_course_teacher(%L, %L, false)::text$q$, v_course, v_teacher), 'ERR:22023'),
    ('a teacher can''t create a project', v_teacher, format($q$select public.create_workspace(%L, 'P', null, 'project', '{}')::text$q$, v_team), 'ERR:42501')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  -- ------------------------------------------------------------------ enrollment
  for r in select * from (values
    ('a student enrolls in an open course', v_student, format('select public.enroll_in_course(%L)::text', v_course), ''),
    ('not in an invite-only one', v_student, format('select public.enroll_in_course(%L)::text', v_course2), 'ERR:42501'),
    ('someone outside the group can''t enroll', v_outsider, format('select public.enroll_in_course(%L)::text', v_course), 'ERR:42501'),
    ('the student sees the course', v_student, format('select count(*)::text from public.workspaces where id = %L', v_course), '1'),
    ('another student doesn''t, before enrolling', v_student2, format('select count(*)::text from public.workspaces where id = %L', v_course), '0')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  -- ------------------------------------------------------------------ course codes
  v_out := pg_temp.run_as(v_teacher2, format($q$select string_agg(code, ',') from public.create_course_codes(%L, 2, 'Scholarship')$q$, v_course2));
  v_checks := v_checks + 1;
  if v_out !~ '^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4},[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$' then v_fail := v_fail || format('the teacher makes two codes: got %s', v_out); end if;
  v_code := split_part(v_out, ',', 1);
  v_code2 := split_part(v_out, ',', 2);

  for r in select * from (values
    ('another teacher can''t make codes for it', v_teacher, format('select count(*)::text from public.create_course_codes(%L, 1)', v_course2), 'ERR:42501'),
    ('a student can''t either', v_student, format('select count(*)::text from public.create_course_codes(%L, 1)', v_course2), 'ERR:42501'),
    ('at most 50 at a time', v_teacher2, format('select count(*)::text from public.create_course_codes(%L, 51)', v_course2), 'ERR:22023'),
    ('its teacher reads its codes', v_teacher2, 'select count(*)::text from public.course_codes', '2'),
    ('another teacher doesn''t', v_teacher, 'select count(*)::text from public.course_codes', '0'),
    ('the admin does', v_admin, format('select count(*)::text from public.course_codes where workspace_id = %L', v_course2), '2'),
    ('nobody writes codes directly', v_teacher2, format($q$update public.course_codes set used_at = now() where workspace_id = %L returning id::text$q$, v_course2), 'ERR:42501')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  -- Someone outside the group uses a code (lower case, no dashes): joins the group and that course only.
  v_out := pg_temp.run_as(v_outsider, format('select public.join_with_code(%L)::text', lower(replace(v_code, '-', ''))));
  v_checks := v_checks + 1;
  if v_out like 'ERR:%' or (v_out::jsonb ->> 'workspace_id')::uuid is distinct from v_course2 then v_fail := v_fail || format('a code joins the group and the course: got %s', v_out); end if;
  v_checks := v_checks + 1;
  if (select role from public.team_members where team_id = v_team and user_id = v_outsider) is distinct from 'member'
     or (select role from public.workspace_members where workspace_id = v_course2 and user_id = v_outsider) is distinct from 'member'
     or exists (select 1 from public.workspace_members where workspace_id = v_course and user_id = v_outsider)
     or (select used_by from public.course_codes where code = v_code) is distinct from v_outsider then
    v_fail := v_fail || text 'as a member of the group, a student of that course only, and the code is used';
  end if;
  for r in select * from (values
    ('the same person again is fine', v_outsider, format('select (public.join_with_code(%L) ->> ''workspace_id'')', v_code), v_course2::text),
    ('a used code is refused to anyone else', v_student2, format('select public.join_with_code(%L)::text', v_code), 'ERR:P0001'),
    ('an unknown code is refused', v_student2, $q$select public.join_with_code('ZZZZ-ZZZZ-ZZZZ')::text$q$, 'ERR:P0001')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  v_out := pg_temp.run_as(v_teacher2, format('select public.revoke_course_code(id)::text from public.course_codes where code = %L', v_code2));
  v_out := pg_temp.run_as(v_student2, format('select public.join_with_code(%L)::text', v_code2));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:P0001' then v_fail := v_fail || format('a withdrawn code is refused: got %s', v_out); end if;
  v_out := pg_temp.run_as(v_teacher2, format('select public.revoke_course_code(id)::text from public.course_codes where code = %L', v_code));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:22023' then v_fail := v_fail || format('a used code can''t be withdrawn: got %s', v_out); end if;

  -- A group invite code still works through the same box.
  insert into public.team_invites (team_id, code, created_by) values (v_team, 'AAAA-BBBB-CCCC', v_owner);
  delete from public.team_members where team_id = v_team and user_id = v_student2;
  v_out := pg_temp.run_as(v_student2, $q$select (public.join_with_code('aaaabbbbcccc') ->> 'team_id')$q$);
  v_checks := v_checks + 1;
  if v_out <> v_team::text then v_fail := v_fail || format('a group invite code joins the group: got %s', v_out); end if;

  -- ------------------------------------------------------------------ the Learning page
  insert into public.learning_modules (workspace_id, title) values (v_course, 'Basics') returning id into v_module;
  insert into public.lessons (workspace_id, module_id, title) values (v_course, v_module, 'One') returning id into v_lesson1;
  insert into public.lessons (workspace_id, module_id, title) values (v_course, v_module, 'Two') returning id into v_lesson2;
  v_out := pg_temp.run_as(v_student, format('insert into public.lesson_progress (lesson_id, workspace_id) values (%L, %L) returning lesson_id::text', v_lesson1, v_course));

  v_json := pg_temp.run_as(v_teacher, format('select public.learning_overview(%L)::text', v_team))::jsonb;
  v_checks := v_checks + 1;
  if jsonb_array_length(v_json -> 'teaching') <> 1
     or v_json #>> '{teaching,0,title}' <> 'Web basics'
     or (v_json #>> '{teaching,0,students}')::int <> 1
     or (v_json #>> '{teaching,0,avg_percent}')::int <> 50
     or (v_json #>> '{teaching,0,not_started}')::int <> 0 then
    v_fail := v_fail || format('the teacher sees only their course, with its class: got %s', v_json -> 'teaching');
  end if;

  v_json := pg_temp.run_as(v_student, format('select public.learning_overview(%L)::text', v_team))::jsonb;
  v_checks := v_checks + 1;
  if jsonb_array_length(v_json -> 'teaching') <> 0
     or v_json #>> '{learning,0,title}' <> 'Web basics'
     or (v_json #>> '{learning,0,done}')::int <> 1
     or v_json #>> '{learning,0,next_lesson,title}' <> 'Two'
     or jsonb_array_length(v_json -> 'browse') <> 0 then
    v_fail := v_fail || format('the student sees their course, progress and next lesson (and no invite-only course to browse): got %s', v_json);
  end if;

  v_json := pg_temp.run_as(v_student2, format('select public.learning_overview(%L)::text', v_team))::jsonb;
  v_checks := v_checks + 1;
  if jsonb_array_length(v_json -> 'browse') <> 1 or v_json #>> '{browse,0,title}' <> 'Web basics' or jsonb_array_length(v_json -> 'learning') <> 0 then
    v_fail := v_fail || format('a new student can browse the open course: got %s', v_json);
  end if;

  v_json := pg_temp.run_as(v_admin, format('select public.learning_overview(%L)::text', v_team))::jsonb;
  v_checks := v_checks + 1;
  if jsonb_array_length(v_json -> 'teaching') <> 2 then v_fail := v_fail || format('admins see every course: got %s', jsonb_array_length(v_json -> 'teaching')); end if;

  v_out := pg_temp.run_as(gen_random_uuid(), format('select public.learning_overview(%L)::text', v_team));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:42501' then v_fail := v_fail || format('someone outside the group gets nothing: got %s', v_out); end if;

  -- ------------------------------------------------------------------ a teacher made a member again
  v_out := pg_temp.run_as(v_owner, format($q$update public.team_members set role = 'member' where team_id = %L and user_id = %L returning role::text$q$, v_team, v_teacher));
  v_checks := v_checks + 1;
  if (select role from public.workspace_members where workspace_id = v_course and user_id = v_teacher) is distinct from 'member' then
    v_fail := v_fail || text 'someone who stops being a teacher stops leading their courses';
  end if;

  -- An admin made a member keeps leading (a company's senior engineer leading onboarding).
  update public.team_members set role = 'admin' where team_id = v_team and user_id = v_teacher2;
  v_out := pg_temp.run_as(v_owner, format($q$update public.team_members set role = 'member' where team_id = %L and user_id = %L returning role::text$q$, v_team, v_teacher2));
  v_checks := v_checks + 1;
  if (select role from public.workspace_members where workspace_id = v_course2 and user_id = v_teacher2) is distinct from 'lead' then
    v_fail := v_fail || text 'an admin made a member keeps the courses they lead';
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception E'learning platform: % of % checks failed:\n  %', array_length(v_fail, 1), v_checks, array_to_string(v_fail, E'\n  ');
  end if;
  raise notice 'learning platform: all % checks passed', v_checks;
end;
$$;

rollback;
