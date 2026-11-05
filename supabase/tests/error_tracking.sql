-- Check for error tracking (20261101120000_error_tracking … 20261105210000_error_issue_threshold).
--
-- Run it against a LOCAL or rehearsal database (DevDock Dev), never production:
--   psql "<dev or local URL>" -v ON_ERROR_STOP=1 -f supabase/tests/error_tracking.sql
--
-- A group with a project lead, a project member and someone else in the group. Checks who can connect
-- sources and see them and their errors, that secrets stay secret, counting, the issue an error gets,
-- an error coming back after Done, a Canceled issue only counting, labels and plans, and "Sync now"'s
-- limit. Rolls back.
-- Raises an exception listing every failed check, so a clean run means every line held.

begin;

create function pg_temp.run_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  begin
    if p_user is null then
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      execute 'set local role anon';
    else
      perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_user)::text, true);
      execute 'set local role authenticated';
    end if;
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
  v_lead     uuid := gen_random_uuid();
  v_member   uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid(); -- in the group, not in the project
  v_team     uuid := gen_random_uuid();
  v_ws       uuid := gen_random_uuid();
  v_fail     text[] := '{}';
  v_checks   integer := 0;
  v_out      text;
  v_hook     uuid;
  v_token    text;
  v_ph       uuid;
  v_key_id   uuid;
  v_group    uuid;
  v_issue    uuid;
  v_number   integer;
  v_number2  integer;
  v_plan     uuid;
  v_plan2    uuid;
  r          record;
begin
  -- ------------------------------------------------------------------ fixtures
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, last_sign_in_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'errors-check-' || u || '@example.test', '{}'::jsonb, now()
  from unnest(array[v_lead, v_member, v_other]) as u;
  insert into public.teams (id, name, slug, type, created_by)
  values (v_team, 'Errors check', 'errors-check-' || left(v_team::text, 8), 'development', v_lead);
  insert into public.team_members (team_id, user_id, role)
  values (v_team, v_lead, 'member'), (v_team, v_member, 'member'), (v_team, v_other, 'member')
  on conflict (team_id, user_id) do update set role = excluded.role;
  insert into public.workspaces (id, team_id, title, type, created_by, access)
  values (v_ws, v_team, 'Errors app', 'project', v_lead, 'members');
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_lead, 'lead'), (v_ws, v_member, 'member')
  on conflict (workspace_id, user_id) do update set role = excluded.role;
  insert into public.workspace_modules (workspace_id, module) values (v_ws, 'issues') on conflict do nothing;

  -- ------------------------------------------------------------------ connecting: flag, then managers only
  v_out := pg_temp.run_as(v_lead, format($q$select public.create_error_source(%L, 'webhook', 'Hook', '{}')::text$q$, v_ws));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:42501' then v_fail := v_fail || format('flag off: connecting is refused: got %s', v_out); end if;

  insert into public.team_feature_flags (team_id, flag, enabled) values (v_team, 'error_tracking', true);

  v_out := pg_temp.run_as(v_member, format($q$select public.create_error_source(%L, 'webhook', 'Hook', '{}')::text$q$, v_ws));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:42501' then v_fail := v_fail || format('a project member can''t connect: got %s', v_out); end if;

  v_out := pg_temp.run_as(v_lead, format($q$select public.create_error_source(%L, 'webhook', 'Hook', '{}')::text$q$, v_ws));
  v_checks := v_checks + 1;
  if v_out like 'ERR:%' then v_fail := v_fail || format('the lead connects a webhook: got %s', v_out); end if;
  v_hook := (v_out::jsonb ->> 'id')::uuid;
  v_token := v_out::jsonb ->> 'token';
  v_checks := v_checks + 1;
  if v_token !~ '^cerr_[0-9a-f]{48}$' then v_fail := v_fail || format('the webhook token is shown once: got %s', v_token); end if;

  for r in select * from (values
    ('an unknown provider', format($q$select public.create_error_source(%L, 'nope', 'X', '{}')::text$q$, v_ws), 'ERR:22023'),
    ('a PostHog host outside the list', format($q$select public.create_error_source(%L, 'posthog', 'X', '{"host":"https://evil.test","project_id":"1"}', 'phx_aaaaaaaaaa')::text$q$, v_ws), 'ERR:22023'),
    ('a PostHog project id that isn''t a number', format($q$select public.create_error_source(%L, 'posthog', 'X', '{"project_id":"abc"}', 'phx_aaaaaaaaaa')::text$q$, v_ws), 'ERR:22023'),
    ('PostHog without a key', format($q$select public.create_error_source(%L, 'posthog', 'X', '{"project_id":"1"}', null)::text$q$, v_ws), 'ERR:22023'),
    ('an empty name', format($q$select public.create_error_source(%L, 'webhook', '  ', '{}')::text$q$, v_ws), 'ERR:23514')
  ) as t(label, sql, expected) loop
    v_out := pg_temp.run_as(v_lead, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  v_out := pg_temp.run_as(v_lead, format($q$select public.create_error_source(%L, 'posthog', 'PostHog', '{"host":"https://eu.posthog.com","project_id":" 698520 "}', 'phx_secret_key_123')::text$q$, v_ws));
  v_checks := v_checks + 1;
  if v_out like 'ERR:%' then v_fail := v_fail || format('the lead connects PostHog: got %s', v_out); end if;
  v_ph := (v_out::jsonb ->> 'id')::uuid;
  v_checks := v_checks + 1;
  if (select config from public.error_sources where id = v_ph) <> '{"host":"https://eu.posthog.com","project_id":"698520"}'::jsonb then
    v_fail := v_fail || text 'PostHog settings are cleaned up';
  end if;
  v_checks := v_checks + 1;
  if public.error_source_api_key(v_ph) is distinct from 'phx_secret_key_123' then v_fail := v_fail || text 'the API key is kept in Vault'; end if;

  -- ------------------------------------------------------------------ who sees what
  for r in select * from (values
    ('the lead sees both sources', v_lead, 'select count(*)::text from public.error_sources', '2'),
    ('a project member sees no sources', v_member, 'select count(*)::text from public.error_sources', '0'),
    ('someone else sees no sources', v_other, 'select count(*)::text from public.error_sources', '0'),
    ('nobody reads the secrets table', v_lead, 'select count(*)::text from private.error_source_secrets', 'ERR:42501'),
    ('nobody reads the API key', v_lead, format('select public.error_source_api_key(%L)', v_ph), 'ERR:42501'),
    ('nobody records errors', v_lead, format($q$select public.error_record(%L, '[]')::text$q$, v_hook), 'ERR:42501'),
    ('nobody makes error issues', v_lead, format($q$select public.error_create_issue(%L, 't', '{}')::text$q$, gen_random_uuid()), 'ERR:42501'),
    ('nobody changes a source''s settings directly', v_lead, format($q$update public.error_sources set config = '{}' where id = %L returning id::text$q$, v_ph), 'ERR:42501'),
    ('the lead renames a source', v_lead, format($q$update public.error_sources set name = 'Renamed' where id = %L returning name$q$, v_hook), 'Renamed'),
    ('a member can''t switch a source off', v_member, format($q$update public.error_sources set enabled = false where id = %L returning id::text$q$, v_hook), '<null>')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  -- The webhook token.
  v_checks := v_checks + 1;
  if (select count(*) from public.error_source_for_token(v_hook, v_token)) <> 1 then v_fail := v_fail || text 'the right token is accepted'; end if;
  v_checks := v_checks + 1;
  if (select count(*) from public.error_source_for_token(v_hook, v_token || 'x')) <> 0 then v_fail := v_fail || text 'a wrong token is refused'; end if;
  v_checks := v_checks + 1;
  if (select count(*) from public.error_source_for_token(v_ph, v_token)) <> 0 then v_fail := v_fail || text 'another source''s token is refused'; end if;
  v_out := pg_temp.run_as(v_lead, format('select public.rotate_error_source_token(%L)', v_hook));
  v_checks := v_checks + 1;
  if (select count(*) from public.error_source_for_token(v_hook, v_token)) <> 0 or (select count(*) from public.error_source_for_token(v_hook, v_out)) <> 1 then
    v_fail := v_fail || text 'a new token replaces the old one';
  end if;
  v_token := v_out;

  -- ------------------------------------------------------------------ counting
  v_out := public.error_record(v_hook, $j$[
    {"fingerprint": "f1", "title": "TypeError: x is undefined", "raw": "TypeError: x is undefined\n  at a.js:1", "url": "https://tracker.test/1",
     "last_seen": "2026-10-31T10:00:00Z", "days": [{"day": "2026-10-30", "count": 3}, {"day": "2026-10-31", "count": 2}]},
    {"fingerprint": "f2", "title": "Network error", "days": [{"day": "2026-10-31", "count": 1}]},
    {"fingerprint": "", "title": "no fingerprint", "days": [{"day": "2026-10-31", "count": 1}]},
    {"fingerprint": "f3", "title": "no counts", "days": []}
  ]$j$)::text;
  v_checks := v_checks + 1;
  if v_out::jsonb <> '{"recorded": 2, "flagged": 2}'::jsonb then v_fail := v_fail || format('two new errors recorded and flagged: got %s', v_out); end if;
  select id into v_group from public.error_groups where source_id = v_hook and fingerprint = 'f1';
  v_checks := v_checks + 1;
  if (select total_count from public.error_groups where id = v_group) <> 5 then v_fail := v_fail || text 'the total adds up the days'; end if;

  v_out := public.error_record(v_hook, $j$[{"fingerprint": "f1", "title": "TypeError: x is undefined", "days": [{"day": "2026-10-31", "count": 4}]}]$j$)::text;
  v_checks := v_checks + 1;
  if v_out::jsonb <> '{"recorded": 1, "flagged": 0}'::jsonb or (select total_count from public.error_groups where id = v_group) <> 9
     or (select count from public.error_group_days where group_id = v_group and day = '2026-10-31') <> 6 then
    v_fail := v_fail || format('the same error again only counts: got %s', v_out);
  end if;
  v_checks := v_checks + 1;
  if (select raw from public.error_groups where id = v_group) not like 'TypeError: x is undefined%' then
    v_fail := v_fail || text 'a report without raw text keeps the one before';
  end if;

  v_checks := v_checks + 1;
  if (select count(*) from public.error_groups_needing_issues(v_hook)) <> 2 then v_fail := v_fail || text 'both errors wait for an issue'; end if;

  -- ------------------------------------------- worth an issue (20261105210000_error_issue_threshold)
  -- A pulled source: one person's burst on one day waits; 2+ people, or a second day, earns an issue.
  perform public.error_record(v_ph, jsonb_build_array(
    jsonb_build_object('fingerprint', 'p1', 'title', 'One laptop''s burst', 'people', 1,
      'days', jsonb_build_array(jsonb_build_object('day', current_date, 'count', 40))),
    jsonb_build_object('fingerprint', 'p2', 'title', 'Reaches two people', 'people', 2,
      'days', jsonb_build_array(jsonb_build_object('day', current_date, 'count', 3))),
    jsonb_build_object('fingerprint', 'p3', 'title', 'People unknown',
      'days', jsonb_build_array(jsonb_build_object('day', current_date, 'count', 1)))));
  v_checks := v_checks + 1;
  if (select string_agg(fingerprint, ',' order by fingerprint) from public.error_groups_needing_issues(v_ph)) is distinct from 'p2' then
    v_fail := v_fail || format('only the error reaching 2 people gets an issue on day one: got %s',
      (select string_agg(fingerprint, ',' order by fingerprint) from public.error_groups_needing_issues(v_ph)));
  end if;
  perform public.error_record(v_ph, jsonb_build_array(
    jsonb_build_object('fingerprint', 'p1', 'title', 'One laptop''s burst', 'people', 1,
      'days', jsonb_build_array(jsonb_build_object('day', current_date - 1, 'count', 1))),
    jsonb_build_object('fingerprint', 'p2', 'title', 'Reaches two people', 'people', 1,
      'days', jsonb_build_array(jsonb_build_object('day', current_date, 'count', 1)))));
  v_checks := v_checks + 1;
  if (select string_agg(fingerprint, ',' order by fingerprint) from public.error_groups_needing_issues(v_ph)) is distinct from 'p1,p2' then
    v_fail := v_fail || text 'an error seen on a second day gets an issue';
  end if;
  v_checks := v_checks + 1;
  if (select people from public.error_groups where source_id = v_ph and fingerprint = 'p2') <> 2 then
    v_fail := v_fail || text 'the most people seen is kept';
  end if;
  v_checks := v_checks + 1;
  if (select count(*) from public.error_groups where source_id = v_ph and fingerprint = 'p3' and needs_issue) <> 1 then
    v_fail := v_fail || text 'an error that waits is still counted and flagged';
  end if;

  -- ------------------------------------------------------------------ the issue
  v_number := public.error_create_issue(v_group, 'Checkout crashes', '{"type":"doc","content":[]}', 2);
  select issue_id into v_issue from public.error_groups where id = v_group;
  select * into r from public.issues where id = v_issue;
  v_checks := v_checks + 1;
  if r.number is distinct from v_number or r.title <> 'Checkout crashes' or r.status <> 'backlog' or r.priority <> 2 or r.created_by is not null then
    v_fail := v_fail || format('the issue is made in Backlog with the AI''s title and priority: got %s', row_to_json(r));
  end if;
  v_checks := v_checks + 1;
  if not exists (select 1 from public.issue_label_links k join public.issue_labels l on l.id = k.label_id where k.issue_id = v_issue and l.name = 'Error' and l.color = 'red') then
    v_fail := v_fail || text 'the issue is labelled Error';
  end if;
  v_checks := v_checks + 1;
  if not exists (select 1 from public.issue_activity a where a.issue_id = v_issue and a.kind = 'created' and a.via = 'errors' and a.actor_id is null) then
    v_fail := v_fail || text 'activity says error tracking made it';
  end if;
  v_checks := v_checks + 1;
  if not exists (select 1 from public.issue_label_links k join public.issue_labels l on l.id = k.label_id where k.issue_id = v_issue and l.name = 'renamed-errors' and l.color = 'violet') then
    v_fail := v_fail || text 'the issue also carries its source''s label (webhook "Renamed" → renamed-errors)';
  end if;
  v_checks := v_checks + 1;
  if private.error_source_label_name('posthog', 'Anything') <> 'posthog-errors'
     or private.error_source_label_name('webhook', '  Sentry alerts! ') <> 'sentry-alerts-errors'
     or private.error_source_label_name('webhook', '***') <> 'webhook-errors' then
    v_fail := v_fail || text 'source label names: posthog-errors, <name>-errors, webhook-errors';
  end if;
  v_checks := v_checks + 1;
  if not exists (select 1 from public.issue_activity a where a.issue_id = v_issue and a.kind = 'label_added' and a.via = 'errors') then
    v_fail := v_fail || text 'the Error label is added by error tracking too';
  end if;
  v_checks := v_checks + 1;
  if (select needs_issue from public.error_groups where id = v_group) then v_fail := v_fail || text 'the error no longer waits'; end if;
  v_checks := v_checks + 1;
  if public.error_create_issue(v_group, 'Again', '{"type":"doc"}', 0) is not null then v_fail := v_fail || text 'an error gets one issue, not two'; end if;

  -- The issue page embeds its error; people in the project read it, others don't.
  for r in select * from (values
    ('a project member reads the error', v_member, format('select e.total_count::text from public.issues i join public.error_groups e on e.issue_id = i.id where i.id = %L', v_issue), '9'),
    ('a project member reads its days', v_member, format('select count(*)::text from public.error_group_days where group_id = %L', v_group), '2'),
    ('someone outside the project doesn''t', v_other, 'select count(*)::text from public.error_groups', '0'),
    ('nor its days', v_other, 'select count(*)::text from public.error_group_days', '0'),
    ('nobody writes errors', v_lead, format('update public.error_groups set total_count = 0 where id = %L returning id::text', v_group), 'ERR:42501')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  -- Open issue: still only counting.
  perform public.error_record(v_hook, format('[{"fingerprint": "f1", "title": "TypeError: x is undefined", "last_seen": %s, "days": [{"day": %s, "count": 1}]}]',
    to_jsonb(now()), to_jsonb(current_date))::jsonb);
  v_checks := v_checks + 1;
  if (select needs_issue from public.error_groups where id = v_group) then v_fail := v_fail || text 'an open issue only counts'; end if;

  -- Done, then it comes back: a new issue that points at the old one.
  update public.issues set status = 'done', completed_at = now() - interval '1 hour' where id = v_issue;
  update public.issues set completed_at = now() - interval '1 hour' where id = v_issue;
  perform public.error_record(v_hook, format('[{"fingerprint": "f1", "title": "TypeError: x is undefined", "last_seen": %s, "days": [{"day": %s, "count": 1}]}]',
    to_jsonb(now()), to_jsonb(current_date))::jsonb);
  v_checks := v_checks + 1;
  if not (select needs_issue from public.error_groups where id = v_group) then v_fail := v_fail || text 'an error back after Done waits for a new issue'; end if;
  v_checks := v_checks + 1;
  if (select previous_issue_number from public.error_groups_needing_issues(v_hook) where id = v_group) is distinct from v_number then
    v_fail := v_fail || text 'the new issue knows which one it came back after';
  end if;
  v_number2 := public.error_create_issue(v_group, 'Checkout crashes again', '{"type":"doc"}', 0);
  v_checks := v_checks + 1;
  if v_number2 is null or v_number2 = v_number
     or (select previous_issue_id from public.error_groups where id = v_group) is distinct from v_issue
     or (select i.number from public.error_groups g join public.issues i on i.id = g.issue_id where g.id = v_group) <> v_number2 then
    v_fail := v_fail || format('the regression gets its own issue: got %s', v_number2);
  end if;

  -- Canceled: "won't fix", only counted.
  update public.issues set status = 'canceled' where number = v_number2 and workspace_id = v_ws;
  perform public.error_record(v_hook, format('[{"fingerprint": "f1", "title": "TypeError: x is undefined", "last_seen": %s, "days": [{"day": %s, "count": 1}]}]',
    to_jsonb(now() + interval '1 second'), to_jsonb(current_date))::jsonb);
  v_checks := v_checks + 1;
  if (select needs_issue from public.error_groups where id = v_group) then v_fail := v_fail || text 'a Canceled issue only counts'; end if;

  -- ------------------------------------------------------------------ plans
  insert into public.plans (team_id, name, lead_id, created_by) values (v_team, 'Error fixes', v_lead, v_lead) returning id into v_plan;
  insert into public.teams (id, name, slug, type, created_by)
  values (gen_random_uuid(), 'Other group', 'errors-other-' || left(gen_random_uuid()::text, 8), 'general', v_lead)
  returning id into v_plan2;
  insert into public.plans (team_id, name) values (v_plan2, 'Elsewhere') returning id into v_plan2;

  -- f2 still waits for its issue; an open issue of this source without a plan:
  v_number := public.error_create_issue((select id from public.error_groups where source_id = v_hook and fingerprint = 'f2'), 'Network fails', '{"type":"doc"}', 0);
  for r in select * from (values
    ('a member can''t choose the plan', v_member, format('select public.set_error_source_plan(%L, %L)::text', v_hook, v_plan), 'ERR:42501'),
    ('another group''s plan is refused', v_lead, format('select public.set_error_source_plan(%L, %L)::text', v_hook, v_plan2), 'ERR:23514'),
    ('the lead chooses the plan; its one open issue without a plan moves in', v_lead, format('select public.set_error_source_plan(%L, %L, true)::text', v_hook, v_plan), '1')
  ) as t(label, uid, sql, expected) loop
    v_out := pg_temp.run_as(r.uid, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;
  v_checks := v_checks + 1;
  if (select plan_id from public.issues where workspace_id = v_ws and number = v_number) is distinct from v_plan
     or (select plan_id from public.issues where workspace_id = v_ws and number = v_number2) is not null then
    v_fail := v_fail || text 'open issues move into the plan; closed ones don''t';
  end if;
  -- New issues go straight into it.
  perform public.error_record(v_hook, format('[{"fingerprint": "f9", "title": "New one", "days": [{"day": %s, "count": 1}]}]', to_jsonb(current_date))::jsonb);
  v_number := public.error_create_issue((select id from public.error_groups where source_id = v_hook and fingerprint = 'f9'), 'New one', '{"type":"doc"}', 0);
  v_checks := v_checks + 1;
  if (select plan_id from public.issues where workspace_id = v_ws and number = v_number) is distinct from v_plan then
    v_fail := v_fail || text 'new issues go into the source''s plan';
  end if;
  v_out := pg_temp.run_as(v_lead, format('select public.set_error_source_plan(%L, null)::text', v_hook));
  v_checks := v_checks + 1;
  if v_out <> '0' or (select plan_id from public.error_sources where id = v_hook) is not null then
    v_fail := v_fail || format('the plan can be cleared: got %s', v_out);
  end if;

  -- ------------------------------------------------------------------ per-day totals and lifetime counts (Sentry)
  perform public.error_record(v_hook, format('[{"fingerprint": "s1", "title": "Sentry one", "days_mode": "set", "total": 50, "days": [{"day": %s, "count": 5}]}]', to_jsonb(current_date))::jsonb);
  select id into v_group from public.error_groups where source_id = v_hook and fingerprint = 's1';
  v_checks := v_checks + 1;
  if (select total_count from public.error_groups where id = v_group) <> 50 then v_fail := v_fail || text 'the lifetime total is kept'; end if;
  perform public.error_record(v_hook, format('[{"fingerprint": "s1", "title": "Sentry one", "days_mode": "set", "total": 50, "days": [{"day": %s, "count": 5}]}]', to_jsonb(current_date))::jsonb);
  v_checks := v_checks + 1;
  if (select total_count from public.error_groups where id = v_group) <> 50 or (select count from public.error_group_days where group_id = v_group and day = current_date) <> 5 then
    v_fail := v_fail || text 're-reading the same day adds nothing';
  end if;
  perform public.error_record(v_hook, format('[{"fingerprint": "s1", "title": "Sentry one", "days_mode": "set", "total": 50, "days": [{"day": %s, "count": 8}]}]', to_jsonb(current_date))::jsonb);
  v_checks := v_checks + 1;
  if (select total_count from public.error_groups where id = v_group) <> 53 or (select count from public.error_group_days where group_id = v_group and day = current_date) <> 8 then
    v_fail := v_fail || format('a day that grew adds only the increase: got %s', (select total_count from public.error_groups where id = v_group));
  end if;
  v_checks := v_checks + 1;
  if private.check_error_source_config('sentry', '{"host": "https://de.sentry.io", "org": " Acme ", "project": "Web-App"}') <> '{"host": "https://de.sentry.io", "org": "acme", "project": "web-app"}'::jsonb
     or private.error_source_label_name('sentry', 'My Sentry') <> 'sentry-errors' then
    v_fail := v_fail || text 'Sentry settings are cleaned up and its label is sentry-errors';
  end if;
  for r in select * from (values
    ('a Sentry host outside the list', format($q$select public.create_error_source(%L, 'sentry', 'S', '{"host":"https://evil.test","org":"a","project":"b"}', 'sntryu_aaaaaaaa')::text$q$, v_ws), 'ERR:22023'),
    ('Sentry without a token', format($q$select public.create_error_source(%L, 'sentry', 'S', '{"org":"a","project":"b"}', null)::text$q$, v_ws), 'ERR:22023')
  ) as t(label, sql, expected) loop
    v_out := pg_temp.run_as(v_lead, r.sql);
    v_checks := v_checks + 1;
    if v_out <> r.expected then v_fail := v_fail || format('%s: got %s', r.label, v_out); end if;
  end loop;

  -- ------------------------------------------------------------------ the daily list and Sync now
  v_checks := v_checks + 1;
  if (select count(*) from public.error_sources_due() where team_id = v_team) <> 2 then v_fail := v_fail || text 'both sources are due'; end if;
  update public.error_sources set enabled = false where id = v_ph;
  v_checks := v_checks + 1;
  if (select count(*) from public.error_sources_due() where team_id = v_team) <> 1 then v_fail := v_fail || text 'a switched-off source isn''t synced'; end if;

  v_out := pg_temp.run_as(v_member, format('select public.request_error_sync(%L)::text', v_hook));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:42501' then v_fail := v_fail || format('a member can''t sync: got %s', v_out); end if;
  v_out := pg_temp.run_as(v_lead, format('select public.request_error_sync(%L)::text', v_hook));
  v_checks := v_checks + 1;
  if v_out like 'ERR:%' then v_fail := v_fail || format('the lead syncs now: got %s', v_out); end if;
  v_out := pg_temp.run_as(v_lead, format('select public.request_error_sync(%L)::text', v_hook));
  v_checks := v_checks + 1;
  if v_out <> 'ERR:DD010' then v_fail := v_fail || format('not twice in 10 minutes: got %s', v_out); end if;

  update public.team_feature_flags set enabled = false where team_id = v_team and flag = 'error_tracking';
  v_checks := v_checks + 1;
  if (select count(*) from public.error_sources_due() where team_id = v_team) <> 0 or (select count(*) from public.error_source_for_token(v_hook, v_token)) <> 0 then
    v_fail := v_fail || text 'flag off: nothing syncs and webhooks are refused';
  end if;

  -- ------------------------------------------------------------------ removing a source removes its secret
  select api_key_id into v_key_id from private.error_source_secrets where source_id = v_ph;
  v_out := pg_temp.run_as(v_lead, format('delete from public.error_sources where id = %L returning id::text', v_ph));
  v_checks := v_checks + 1;
  if v_out like 'ERR:%' or exists (select 1 from vault.secrets where id = v_key_id) then
    v_fail := v_fail || format('deleting a source deletes its API key: got %s', v_out);
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception E'error tracking: % of % checks failed:\n  %', array_length(v_fail, 1), v_checks, array_to_string(v_fail, E'\n  ');
  end if;
  raise notice 'error tracking: all % checks passed', v_checks;
end;
$$;

rollback;
