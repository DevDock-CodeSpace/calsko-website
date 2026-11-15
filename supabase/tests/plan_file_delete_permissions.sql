-- Assigned plan leads can delete individual files in their plan; other members cannot.
-- Team owners/admins retain their existing ability to delete team-wide files.
--
-- Run against a local or rehearsal database, never production:
--   psql "<dev or local url>" -v ON_ERROR_STOP=1 -f supabase/tests/plan_file_delete_permissions.sql
--
-- The fixture runs in a transaction and rolls back.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_other_lead uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_other_plan uuid := gen_random_uuid();
  v_folder uuid;
  v_lead_doc uuid;
  v_member_doc uuid;
  v_other_plan_doc uuid;
  v_admin_doc uuid;
  v_root_doc uuid;
  v_lead_board uuid;
  v_member_board uuid;
  v_other_plan_board uuid;
  v_admin_board uuid;
  v_root_board uuid;
  v_rows integer;
  v_fail text[] := '{}';
  v_checks integer := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'plan-file-delete-' || u || '@example.test', '{}'::jsonb
  from unnest(array[v_owner, v_admin, v_lead, v_member, v_other_lead]) as u;

  insert into public.teams (id, name, slug, type, created_by)
  values (v_team, 'Plan file delete check', 'plan-file-delete-' || left(v_team::text, 8), 'general', v_owner);
  insert into public.team_members (team_id, user_id, role)
  values (v_team, v_owner, 'owner'), (v_team, v_admin, 'admin'), (v_team, v_lead, 'member'),
         (v_team, v_member, 'member'), (v_team, v_other_lead, 'member');

  insert into public.plans (id, team_id, name, lead_id, created_by)
  values (v_plan, v_team, 'Plan A', v_lead, v_member),
         (v_other_plan, v_team, 'Plan B', v_other_lead, v_member);
  select folder_id into v_folder from public.plans where id = v_plan;

  insert into public.documents (team_id, workspace_id, folder_id, title, created_by)
  values (v_team, null, v_folder, 'Lead doc', v_member) returning id into v_lead_doc;
  insert into public.documents (team_id, workspace_id, folder_id, title, created_by)
  values (v_team, null, v_folder, 'Member doc', v_member) returning id into v_member_doc;
  insert into public.documents (team_id, workspace_id, folder_id, title, created_by)
  select v_team, null, p.folder_id, 'Other plan doc', v_member from public.plans p where p.id = v_other_plan
  returning id into v_other_plan_doc;
  insert into public.documents (team_id, workspace_id, folder_id, title, created_by)
  values (v_team, null, v_folder, 'Admin doc', v_member) returning id into v_admin_doc;
  insert into public.documents (team_id, workspace_id, title, created_by)
  values (v_team, null, 'Root doc', v_member) returning id into v_root_doc;

  insert into public.diagrams (team_id, workspace_id, folder_id, title, data, created_by)
  values (v_team, null, v_folder, 'Lead whiteboard', '{}'::jsonb, v_member) returning id into v_lead_board;
  insert into public.diagrams (team_id, workspace_id, folder_id, title, data, created_by)
  values (v_team, null, v_folder, 'Member whiteboard', '{}'::jsonb, v_member) returning id into v_member_board;
  insert into public.diagrams (team_id, workspace_id, folder_id, title, data, created_by)
  select v_team, null, p.folder_id, 'Other plan whiteboard', '{}'::jsonb, v_member from public.plans p where p.id = v_other_plan
  returning id into v_other_plan_board;
  insert into public.diagrams (team_id, workspace_id, folder_id, title, data, created_by)
  values (v_team, null, v_folder, 'Admin whiteboard', '{}'::jsonb, v_member) returning id into v_admin_board;
  insert into public.diagrams (team_id, workspace_id, title, data, created_by)
  values (v_team, null, 'Root whiteboard', '{}'::jsonb, v_member) returning id into v_root_board;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_lead)::text, true);
  execute 'set local role authenticated';
  execute 'with d as (delete from public.documents where id = $1 returning 1) select count(*) from d'
    into v_rows using v_lead_doc;
  execute 'with d as (delete from public.diagrams where id = $1 returning 1) select count(*) from d'
    into v_checks using v_lead_board;
  execute 'reset role';
  if v_rows <> 1 or v_checks <> 1 then v_fail := v_fail || 'assigned lead could not delete plan doc and whiteboard'; end if;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_member)::text, true);
  execute 'set local role authenticated';
  execute 'with d as (delete from public.documents where id = $1 returning 1) select count(*) from d'
    into v_rows using v_member_doc;
  execute 'with d as (delete from public.diagrams where id = $1 returning 1) select count(*) from d'
    into v_checks using v_member_board;
  execute 'reset role';
  if v_rows <> 0 or v_checks <> 0 then v_fail := v_fail || 'non-lead member deleted a plan doc or whiteboard'; end if;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_other_lead)::text, true);
  execute 'set local role authenticated';
  execute 'with d as (delete from public.documents where id = $1 returning 1) select count(*) from d'
    into v_rows using v_other_plan_doc;
  execute 'with d as (delete from public.diagrams where id = $1 returning 1) select count(*) from d'
    into v_checks using v_other_plan_board;
  execute 'reset role';
  if v_rows <> 0 or v_checks <> 0 then v_fail := v_fail || 'lead of another plan deleted these plan files'; end if;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_lead)::text, true);
  execute 'set local role authenticated';
  execute 'with d as (delete from public.documents where id = $1 returning 1) select count(*) from d'
    into v_rows using v_root_doc;
  execute 'with d as (delete from public.diagrams where id = $1 returning 1) select count(*) from d'
    into v_checks using v_root_board;
  execute 'reset role';
  if v_rows <> 0 or v_checks <> 0 then v_fail := v_fail || 'plan lead deleted files outside a plan folder'; end if;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_admin)::text, true);
  execute 'set local role authenticated';
  execute 'with d as (delete from public.documents where id = $1 returning 1) select count(*) from d'
    into v_rows using v_admin_doc;
  execute 'with d as (delete from public.diagrams where id = $1 returning 1) select count(*) from d'
    into v_checks using v_admin_board;
  execute 'reset role';
  if v_rows <> 1 or v_checks <> 1 then v_fail := v_fail || 'team admin lost existing plan file delete access'; end if;

  if cardinality(v_fail) > 0 then
    raise exception 'Plan file delete checks failed: %', array_to_string(v_fail, '; ');
  end if;
  raise notice 'Plan file delete checks passed';
end;
$$;

rollback;
