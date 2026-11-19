-- The linked Plan Whiteboard is editable by its lead, creator, team admins,
-- and Developers in workspaces with Plan issues. Developers can edit but cannot
-- delete the board or Plan. Other Plan-folder whiteboards keep their existing
-- team-wide edit behavior.
--
-- Run against a local or rehearsal database, never production:
--   psql "<dev or local url>" -v ON_ERROR_STOP=1 -f supabase/tests/plan_whiteboard_access.sql

begin;

do $$
declare
  v_owner               uuid := gen_random_uuid();
  v_admin               uuid := gen_random_uuid();
  v_lead                uuid := gen_random_uuid();
  v_creator             uuid := gen_random_uuid();
  v_member              uuid := gen_random_uuid();
  v_developer           uuid := gen_random_uuid();
  v_unrelated_developer uuid := gen_random_uuid();
  v_team                uuid := gen_random_uuid();
  v_plan                uuid := gen_random_uuid();
  v_collection          uuid := gen_random_uuid();
  v_developer_space     uuid := gen_random_uuid();
  v_unrelated_space     uuid := gen_random_uuid();
  v_board               uuid;
  v_other               uuid;
  v_fail                text[] := '{}';
  v_checks              integer := 0;
  r record;
  v_rows                integer;
  v_level               smallint;
  v_editable            boolean;
  v_blocked             boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'plan-whiteboard-check-' || u || '@example.test', '{}'::jsonb
    from unnest(array[v_owner, v_admin, v_lead, v_creator, v_member, v_developer, v_unrelated_developer]) as u;

  insert into public.teams (id, name, slug, type, created_by)
  values (v_team, 'Plan whiteboard check', 'plan-whiteboard-' || left(v_team::text, 8), 'general', v_owner);
  insert into public.team_members (team_id, user_id, role)
  values (v_team, v_owner, 'owner'), (v_team, v_admin, 'admin'),
         (v_team, v_lead, 'member'), (v_team, v_creator, 'member'), (v_team, v_member, 'member'),
         (v_team, v_developer, 'member'), (v_team, v_unrelated_developer, 'member');

  insert into public.workspace_collections (id, team_id, name, type, created_by)
  values (v_collection, v_team, 'Development', 'development', v_owner);
  insert into public.workspaces (id, team_id, title, type, created_by, collection_id)
  values
    (v_developer_space, v_team, 'Plan issue Space', 'general', v_owner, v_collection),
    (v_unrelated_space, v_team, 'Unrelated Space', 'general', v_owner, v_collection);
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_developer_space, v_developer, 'developer'),
         (v_unrelated_space, v_unrelated_developer, 'developer');

  perform set_config('devdock.plan_whiteboard', 'on', true);
  insert into public.plans (id, team_id, name, lead_id, created_by)
  values (v_plan, v_team, 'Permission check', v_lead, v_creator);
  perform set_config('devdock.plan_whiteboard', '', true);

  insert into public.issues (workspace_id, title, plan_id, created_by)
  values (v_developer_space, 'Issue in the Plan', v_plan, v_developer);

  select p.whiteboard_id into v_board from public.plans p where p.id = v_plan;
  insert into public.diagrams (team_id, workspace_id, folder_id, title)
  select v_team, null, p.folder_id, 'Other Plan whiteboard'
    from public.plans p where p.id = v_plan
  returning id into v_other;

  -- The computed edit state and actual writes agree for every Plan role.
  for r in
    select * from (values
      ('owner',   v_owner,   true,  3::smallint, 1),
      ('admin',   v_admin,   true,  3::smallint, 1),
      ('lead',    v_lead,    true,  3::smallint, 1),
      ('creator', v_creator, true,  3::smallint, 1),
      ('developer', v_developer, true, 3::smallint, 1),
      ('member',  v_member,  false, 1::smallint, 0),
      ('unrelated developer', v_unrelated_developer, false, 1::smallint, 0)
    ) as t(person, user_id, editable, access_level, rows_expected)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'sub', r.user_id)::text, true);
    execute 'set local role authenticated';

    execute 'select public.plan_whiteboard_editable(d), public.access_level(d) from public.diagrams d where d.id = $1'
      into v_editable, v_level using v_board;
    execute 'with u as (update public.diagrams set data = jsonb_build_object(''editor'', $2) where id = $1 returning 1) select count(*) from u'
      into v_rows using v_board, r.person;
    execute 'reset role';

    v_checks := v_checks + 1;
    if v_editable is distinct from r.editable then
      v_fail := v_fail || format('%s UI edit state: expected %s, got %s', r.person, r.editable, v_editable);
    end if;
    if v_level is distinct from r.access_level then
      v_fail := v_fail || format('%s access level: expected %s, got %s', r.person, r.access_level, v_level);
    end if;
    if v_rows <> r.rows_expected then
      v_fail := v_fail || format('%s saved linked Whiteboard: expected %s rows, got %s', r.person, r.rows_expected, v_rows);
    end if;
  end loop;

  -- The restriction is only for the Plan's linked board, not every whiteboard in its folder.
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_member)::text, true);
  execute 'set local role authenticated';
  execute 'with u as (update public.diagrams set title = title || ''!'' where id = $1 returning 1) select count(*) from u'
    into v_rows using v_other;
  execute 'reset role';
  v_checks := v_checks + 1;
  if v_rows <> 1 then
    v_fail := v_fail || 'ordinary team member could not edit a different whiteboard in the Plan folder';
  end if;

  -- A qualifying Developer can edit, but cannot delete the Whiteboard or the Plan.
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_developer)::text, true);
  execute 'set local role authenticated';
  execute 'with d as (delete from public.diagrams where id = $1 returning 1) select count(*) from d'
    into v_rows using v_board;
  execute 'reset role';
  v_checks := v_checks + 1;
  if v_rows <> 0 then v_fail := v_fail || 'Developer deleted the Plan Whiteboard'; end if;

  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_developer)::text, true);
  execute 'set local role authenticated';
  begin
    execute 'select public.delete_plan($1)' using v_plan;
  exception when sqlstate '42501' then
    v_blocked := true;
  end;
  execute 'reset role';
  v_checks := v_checks + 1;
  if not v_blocked then v_fail := v_fail || 'Developer deleted the Plan'; end if;

  if cardinality(v_fail) > 0 then
    raise exception E'% of % checks failed:\n%', cardinality(v_fail), v_checks, array_to_string(v_fail, E'\n');
  end if;
  raise notice 'Plan whiteboard access: all % checks passed', v_checks;
end;
$$;

rollback;
