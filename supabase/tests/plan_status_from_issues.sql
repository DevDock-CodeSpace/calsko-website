-- A plan starts when one of its issues enters In Progress or In Review.
-- Run against a local or rehearsal database, never production:
--   psql "<local or Dev URL>" -v ON_ERROR_STOP=1 -f supabase/tests/plan_status_from_issues.sql

begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_plan uuid;
  v_issue uuid;
  v_status public.plan_status;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'plan-status-check-' || v_user || '@example.test', '{}'::jsonb);

  insert into public.teams (id, name, slug, type, created_by)
  values (v_team, 'Plan status check', 'plan-status-check-' || left(v_team::text, 8), 'development', v_user);

  insert into public.workspaces (id, team_id, title, type, created_by, access)
  values (v_workspace, v_team, 'Plan status check', 'project', v_user, 'members');

  insert into public.plans (team_id, name) values (v_team, 'Active work') returning id into v_plan;
  insert into public.issues (workspace_id, title, status, plan_id)
  values (v_workspace, 'Todo issue', 'todo', v_plan)
  returning id into v_issue;

  select status into v_status from public.plans where id = v_plan;
  if v_status <> 'not_started' then
    raise exception 'Todo alone must not start a plan; got %', v_status;
  end if;

  update public.issues set status = 'in_progress' where id = v_issue;
  select status into v_status from public.plans where id = v_plan;
  if v_status <> 'in_progress' then
    raise exception 'In Progress issue must start its plan; got %', v_status;
  end if;

  insert into public.plans (team_id, name) values (v_team, 'Review work') returning id into v_plan;
  insert into public.issues (workspace_id, title, status, plan_id)
  values (v_workspace, 'Review issue', 'in_review', v_plan);
  select status into v_status from public.plans where id = v_plan;
  if v_status <> 'in_progress' then
    raise exception 'In Review issue must start its plan; got %', v_status;
  end if;

  insert into public.plans (team_id, name) values (v_team, 'Assigned work') returning id into v_plan;
  insert into public.issues (workspace_id, title, status)
  values (v_workspace, 'Already active issue', 'in_progress')
  returning id into v_issue;
  update public.issues set plan_id = v_plan where id = v_issue;
  select status into v_status from public.plans where id = v_plan;
  if v_status <> 'in_progress' then
    raise exception 'Assigning an active issue must start its plan; got %', v_status;
  end if;

  for v_status in
    select unnest(array['paused', 'done', 'canceled']::public.plan_status[])
  loop
    insert into public.plans (team_id, name, status)
    values (v_team, 'Keep ' || v_status::text, v_status)
    returning id into v_plan;
    insert into public.issues (workspace_id, title, status, plan_id)
    values (v_workspace, 'Active issue', 'in_progress', v_plan);
    if (select status from public.plans where id = v_plan) <> v_status then
      raise exception 'An active issue must preserve the manually selected % plan status', v_status;
    end if;
  end loop;
end;
$$;

rollback;
