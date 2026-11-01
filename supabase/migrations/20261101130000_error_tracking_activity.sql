-- Fixes to error tracking found by supabase/tests/error_tracking.sql:
-- - Error tracking makes issues itself (error_create_issue sets devdock.via = 'errors'), so issue
--   activity accepts 'errors' beside 'github' as the source of a change.
-- - error_record tells a new error from a known one by whether its row was inserted, not by timestamps.
-- - error_create_issue never stamps a person as the issue's creator (nobody made it).
-- - Label changes say where they came from too, so the Error label on a new issue reads
--   "Error tracking added label Error", not "Someone".

alter table public.issue_activity drop constraint issue_activity_via;
alter table public.issue_activity add constraint issue_activity_via check (via is null or via in ('github', 'errors'));

create or replace function public.error_record(p_source uuid, p_reports jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.error_sources;
  v_report jsonb;
  v_days jsonb;
  v_sum bigint;
  v_first timestamptz;
  v_last timestamptz;
  v_group public.error_groups;
  v_group_id uuid;
  v_inserted boolean;
  v_status public.issue_status;
  v_completed timestamptz;
  v_recorded integer := 0;
  v_flagged integer := 0;
begin
  select * into v_source from public.error_sources s where s.id = p_source;
  if v_source.id is null then
    raise exception 'Error source not found' using errcode = '23503';
  end if;
  if jsonb_typeof(p_reports) <> 'array' or jsonb_array_length(p_reports) > 500 then
    raise exception 'Reports must be an array of at most 500' using errcode = '22023';
  end if;

  for v_report in select value from jsonb_array_elements(p_reports) loop
    continue when jsonb_typeof(v_report) <> 'object'
      or char_length(coalesce(v_report ->> 'fingerprint', '')) not between 1 and 200
      or char_length(btrim(coalesce(v_report ->> 'title', ''))) = 0;

    -- Days: valid dates within the last 90 days, positive counts, at most 31 of them.
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', d.count)), '[]'::jsonb), coalesce(sum(d.count), 0)
    into v_days, v_sum
    from (
      select (e ->> 'day')::date as day, sum(least((e ->> 'count')::bigint, 100000000))::integer as count
      from jsonb_array_elements(case when jsonb_typeof(v_report -> 'days') = 'array' then v_report -> 'days' else '[]'::jsonb end) e
      where (e ->> 'day') ~ '^\d{4}-\d{2}-\d{2}$'
        and (e ->> 'count') ~ '^\d{1,9}$'
        and (e ->> 'count')::bigint > 0
        and (e ->> 'day')::date between current_date - 90 and current_date + 1
      group by 1
      order by 1 desc
      limit 31
    ) d;
    continue when v_sum = 0;

    v_last := least(coalesce(nullif(v_report ->> 'last_seen', '')::timestamptz, now()), now());
    v_first := least(coalesce(nullif(v_report ->> 'first_seen', '')::timestamptz, v_last), v_last);

    insert into public.error_groups as g
      (team_id, workspace_id, source_id, fingerprint, title, raw, url, first_seen, last_seen, total_count)
    values (
      v_source.team_id, v_source.workspace_id, p_source,
      v_report ->> 'fingerprint',
      left(btrim(v_report ->> 'title'), 300),
      left(coalesce(v_report ->> 'raw', ''), 20000),
      case when (v_report ->> 'url') ~ '^https://' then left(v_report ->> 'url', 2000) end,
      v_first, v_last, v_sum
    )
    on conflict (source_id, fingerprint) do update set
      title = excluded.title,
      raw = case when excluded.raw <> '' then excluded.raw else g.raw end,
      url = coalesce(excluded.url, g.url),
      first_seen = least(g.first_seen, excluded.first_seen),
      last_seen = greatest(g.last_seen, excluded.last_seen),
      total_count = g.total_count + excluded.total_count
    returning g.id, (g.xmax = 0) into v_group_id, v_inserted;
    select * into v_group from public.error_groups g where g.id = v_group_id;

    insert into public.error_group_days as d (group_id, day, count)
    select v_group.id, (e ->> 'day')::date, (e ->> 'count')::integer from jsonb_array_elements(v_days) e
    on conflict (group_id, day) do update set count = least(d.count::bigint + excluded.count, 2000000000)::integer;

    -- Does it need an issue? New (none yet, or its issue was deleted), or back after Done.
    if not v_group.needs_issue then
      if v_group.issue_id is null then
        update public.error_groups set needs_issue = true where id = v_group.id;
        v_flagged := v_flagged + 1;
      else
        select i.status, i.completed_at into v_status, v_completed from public.issues i where i.id = v_group.issue_id;
        if v_status = 'done' and v_last > v_completed then
          update public.error_groups set needs_issue = true where id = v_group.id;
          v_flagged := v_flagged + 1;
        end if;
      end if;
    elsif v_inserted then
      v_flagged := v_flagged + 1;
    end if;
    v_recorded := v_recorded + 1;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'flagged', v_flagged);
end;
$$;

create or replace function public.error_create_issue(p_group uuid, p_title text, p_description jsonb, p_priority integer default 0)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.error_groups;
  v_label uuid;
  v_issue uuid;
  v_number integer;
  v_previous uuid;
begin
  select * into v_group from public.error_groups g where g.id = p_group for update;
  if v_group.id is null or not v_group.needs_issue then
    return null;
  end if;
  if jsonb_typeof(p_description) <> 'object' then
    raise exception 'The description must be a document' using errcode = '22023';
  end if;

  -- The source's label, else the project's "Error" label (made when missing).
  select s.label_id into v_label from public.error_sources s where s.id = v_group.source_id;
  if v_label is null then
    select l.id into v_label from public.issue_labels l
    where l.workspace_id = v_group.workspace_id and lower(btrim(l.name)) = 'error';
    if v_label is null then
      insert into public.issue_labels (workspace_id, name, color) values (v_group.workspace_id, 'Error', 'red')
      on conflict do nothing
      returning id into v_label;
    end if;
  end if;

  -- The issue it came back after (Done), kept for "Came back after QB-12".
  select i.id into v_previous from public.issues i where i.id = v_group.issue_id and i.status = 'done';

  perform set_config('devdock.via', 'errors', true);
  insert into public.issues (workspace_id, title, description, status, priority, created_by)
  values (
    v_group.workspace_id,
    left(coalesce(nullif(btrim(p_title), ''), v_group.title), 200),
    p_description,
    'backlog',
    case when p_priority between 0 and 4 then p_priority else 0 end,
    null
  )
  returning id, number into v_issue, v_number;

  if v_label is not null then
    insert into public.issue_label_links (issue_id, label_id, workspace_id)
    values (v_issue, v_label, v_group.workspace_id)
    on conflict do nothing;
  end if;

  update public.error_groups
  set issue_id = v_issue,
      previous_issue_id = coalesce(v_previous, previous_issue_id),
      needs_issue = false
  where id = p_group;

  return v_number;
end;
$$;

create or replace function private.log_issue_label_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.issue_label_links := case when tg_op = 'INSERT' then new else old end;
  label_name text := (select l.name from public.issue_labels l where l.id = link.label_id);
begin
  if label_name is null or not exists (select 1 from public.issues i where i.id = link.issue_id) then
    return null;
  end if;
  insert into public.issue_activity (issue_id, workspace_id, actor_id, kind, to_value, via)
  values (
    link.issue_id, link.workspace_id, (select auth.uid()),
    case when tg_op = 'INSERT' then 'label_added' else 'label_removed' end,
    label_name,
    nullif(current_setting('devdock.via', true), '')
  );
  return null;
end;
$$;
revoke all on function private.log_issue_label_activity() from public, anon, authenticated;
