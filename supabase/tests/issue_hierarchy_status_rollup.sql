-- Parent statuses follow all descendants, regardless of GitHub connection or
-- how a child reached Done. Run in a local or Dev database, never production:
--   psql "<local or Dev URL>" -v ON_ERROR_STOP=1 -f supabase/tests/issue_hierarchy_status_rollup.sql

begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_parent uuid;
  v_child_one uuid;
  v_child_two uuid;
  v_status public.issue_status;
  v_via text;
  v_repo uuid;
  v_locked uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'issue-hierarchy-check-' || v_user || '@example.test', '{}'::jsonb);

  insert into public.teams (id, name, slug, type, created_by)
  values (v_team, 'Issue hierarchy check', 'issue-hierarchy-check-' || left(v_team::text, 8), 'development', v_user);

  insert into public.workspaces (id, team_id, title, type, created_by, access)
  values (v_workspace, v_team, 'Issue hierarchy check', 'project', v_user, 'members');

  insert into public.issues (workspace_id, title, status)
  values (v_workspace, 'Two children', 'in_progress')
  returning id into v_parent;
  insert into public.issues (workspace_id, title, status, parent_id)
  values (v_workspace, 'First child', 'todo', v_parent)
  returning id into v_child_one;
  insert into public.issues (workspace_id, title, status, parent_id)
  values (v_workspace, 'Second child', 'todo', v_parent)
  returning id into v_child_two;

  update public.issues set status = 'done' where id = v_child_one;
  select status into v_status from public.issues where id = v_parent;
  if v_status <> 'in_progress' then
    raise exception 'One completed child must leave the parent in progress; got %', v_status;
  end if;

  update public.issues set status = 'done' where id = v_child_two;
  select status into v_status from public.issues where id = v_parent;
  if v_status <> 'done' then
    raise exception 'All manually completed children must complete the parent; got %', v_status;
  end if;
  select via into v_via
  from public.issue_activity
  where issue_id = v_parent and kind = 'status'
  order by id desc limit 1;
  if v_via is distinct from 'rollup' then
    raise exception 'A rolled-up parent status must be attributed to Calsko; got %', v_via;
  end if;

  update public.issues set status = 'todo' where id = v_child_one;
  select via into v_via
  from public.issue_activity
  where issue_id = v_child_one and kind = 'status'
  order by id desc limit 1;
  if v_via is not null then
    raise exception 'A later child status change must keep its original source; got %', v_via;
  end if;

  insert into public.issues (workspace_id, title, status)
  values (v_workspace, 'Already done parent', 'done')
  returning id into v_parent;
  insert into public.issues (workspace_id, title, status, parent_id)
  values (v_workspace, 'Imported done child', 'done', v_parent);
  select status into v_status from public.issues where id = v_parent;
  if v_status <> 'done' then
    raise exception 'Adding a Done child must not reopen a Done parent; got %', v_status;
  end if;

  insert into public.issues (workspace_id, title, status)
  values (v_workspace, 'Parent with canceled child', 'done')
  returning id into v_parent;
  insert into public.issues (workspace_id, title, status, parent_id)
  values (v_workspace, 'Canceled child', 'canceled', v_parent);
  select status into v_status from public.issues where id = v_parent;
  if v_status <> 'todo' then
    raise exception 'A Done parent with an unfinished child must reopen to Todo; got %', v_status;
  end if;

  insert into public.issues (workspace_id, title, status)
  values (v_workspace, 'Parent in review', 'in_review')
  returning id into v_parent;
  insert into public.issues (workspace_id, title, status, parent_id)
  values (v_workspace, 'Active child', 'in_progress', v_parent);
  select status into v_status from public.issues where id = v_parent;
  if v_status <> 'in_progress' then
    raise exception 'An active child must move an In Review parent to In Progress; got %', v_status;
  end if;

  insert into public.issues (workspace_id, title, status)
  values (v_workspace, 'Canceled parent', 'canceled')
  returning id into v_parent;
  insert into public.issues (workspace_id, title, status, parent_id)
  values (v_workspace, 'New active child', 'in_progress', v_parent);
  select status into v_status from public.issues where id = v_parent;
  if v_status <> 'in_progress' then
    raise exception 'An active child must revive a canceled parent; got %', v_status;
  end if;

  -- No signed-in user here, so the GitHub status lock applies as it does to a member.
  insert into public.github_installations (team_id, installation_id, account_login, account_type)
  values (v_team, 999999001, 'issue-hierarchy-check', 'User');
  insert into public.repos (team_id, owner, name, github_repo_id, installation_id)
  values (v_team, 'issue-hierarchy-check', 'repo', 999999001, 999999001)
  returning id into v_repo;
  insert into public.workspace_repos (workspace_id, repo_id, team_id, base_branch)
  values (v_workspace, v_repo, v_team, 'main');

  insert into public.issues (workspace_id, title, status, repo_id)
  values (v_workspace, 'GitHub-linked parent', 'todo', v_repo)
  returning id into v_parent;
  insert into public.issues (workspace_id, title, status, parent_id)
  values (v_workspace, 'Plain child', 'todo', v_parent)
  returning id into v_child_one;
  update public.issues set status = 'done' where id = v_child_one;
  select status into v_status from public.issues where id = v_parent;
  if v_status <> 'done' then
    raise exception 'Finishing the last child must complete a GitHub-linked parent; got %', v_status;
  end if;

  insert into public.issues (workspace_id, title, status, repo_id)
  values (v_workspace, 'GitHub-linked issue', 'todo', v_repo)
  returning id into v_locked;
  begin
    update public.issues set status = 'done' where id = v_locked;
    raise exception 'Setting Done by hand on a GitHub-linked issue must still be blocked';
  exception when sqlstate 'DD001' then
    null;
  end;
end;
$$;

rollback;
