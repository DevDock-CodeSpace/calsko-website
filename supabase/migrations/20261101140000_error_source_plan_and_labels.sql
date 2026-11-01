-- Error tracking, owner's choices (2026-11-01):
-- - A source can put its issues in a plan (chosen or made when connecting, changeable later).
-- - Every error issue carries two labels: "Error", and one for where it came from: "posthog-errors" for
--   PostHog, "<source name>-errors" for a webhook ("Sentry alerts" → "sentry-alerts-errors").
-- The issues error tracking already made get their source label here.

alter table public.error_sources
  add column plan_id uuid references public.plans (id) on delete set null;

create index error_sources_plan_idx on public.error_sources (plan_id);

comment on column public.error_sources.plan_id is 'The plan new issues from this source go into; null = none.';

-- The source's own label name.
create function private.error_source_label_name(p_provider text, p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_provider = 'posthog' then 'posthog-errors'
    else coalesce(
      nullif(left(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 33), ''),
      p_provider
    ) || '-errors'
  end;
$$;
revoke all on function private.error_source_label_name(text, text) from public, anon, authenticated;

-- The project's label with that name, made (in that color) when missing.
create function private.ensure_issue_label(p_workspace uuid, p_name text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select l.id into v_id from public.issue_labels l
  where l.workspace_id = p_workspace and lower(btrim(l.name)) = lower(btrim(p_name));
  if v_id is null then
    insert into public.issue_labels (workspace_id, name, color) values (p_workspace, p_name, p_color)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select l.id into v_id from public.issue_labels l
      where l.workspace_id = p_workspace and lower(btrim(l.name)) = lower(btrim(p_name));
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function private.ensure_issue_label(uuid, text, text) from public, anon, authenticated;

-- Chooses the source's plan (null = none). p_include_existing also moves the open issues it already
-- made that have no plan yet. Managers of the project; the plan must be the group's.
create function public.set_error_source_plan(p_source_id uuid, p_plan_id uuid, p_include_existing boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.error_sources;
  v_moved integer := 0;
begin
  select * into v_source from public.error_sources s where s.id = p_source_id;
  if v_source.id is null or not private.can_manage_workspace(v_source.workspace_id) then
    raise exception 'Error source not found' using errcode = '42501';
  end if;
  if p_plan_id is not null and not exists (select 1 from public.plans p where p.id = p_plan_id and p.team_id = v_source.team_id) then
    raise exception 'The plan must be in the same group' using errcode = '23514';
  end if;

  update public.error_sources set plan_id = p_plan_id where id = p_source_id;

  if p_plan_id is not null and p_include_existing then
    update public.issues i
    set plan_id = p_plan_id
    from public.error_groups g
    where g.source_id = p_source_id
      and g.issue_id = i.id
      and i.plan_id is null
      and i.status not in ('done', 'canceled');
    get diagnostics v_moved = row_count;
  end if;
  return v_moved;
end;
$$;
revoke all on function public.set_error_source_plan(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_error_source_plan(uuid, uuid, boolean) to authenticated;

-- The issue: Error + the source's label (+ the source's own chosen label), and the source's plan.
create or replace function public.error_create_issue(p_group uuid, p_title text, p_description jsonb, p_priority integer default 0)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.error_groups;
  v_source public.error_sources;
  v_labels uuid[];
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
  select * into v_source from public.error_sources s where s.id = v_group.source_id;

  v_labels := array_remove(array[
    private.ensure_issue_label(v_group.workspace_id, 'Error', 'red'),
    private.ensure_issue_label(v_group.workspace_id, private.error_source_label_name(v_source.provider, v_source.name),
      case when v_source.provider = 'posthog' then 'orange' else 'violet' end),
    v_source.label_id
  ], null);

  -- The issue it came back after (Done), kept for "Came back after QB-12".
  select i.id into v_previous from public.issues i where i.id = v_group.issue_id and i.status = 'done';

  perform set_config('devdock.via', 'errors', true);
  insert into public.issues (workspace_id, title, description, status, priority, created_by, plan_id)
  values (
    v_group.workspace_id,
    left(coalesce(nullif(btrim(p_title), ''), v_group.title), 200),
    p_description,
    'backlog',
    case when p_priority between 0 and 4 then p_priority else 0 end,
    null,
    v_source.plan_id
  )
  returning id, number into v_issue, v_number;

  insert into public.issue_label_links (issue_id, label_id, workspace_id)
  select v_issue, l, v_group.workspace_id from unnest(v_labels) as l
  on conflict do nothing;

  update public.error_groups
  set issue_id = v_issue,
      previous_issue_id = coalesce(v_previous, previous_issue_id),
      needs_issue = false
  where id = p_group;

  return v_number;
end;
$$;

-- The issues already made get their source's label (activity: "Error tracking added label …").
do $$
begin
  perform set_config('devdock.via', 'errors', true);
  insert into public.issue_label_links (issue_id, label_id, workspace_id)
  select g.issue_id,
         private.ensure_issue_label(g.workspace_id, private.error_source_label_name(s.provider, s.name),
           case when s.provider = 'posthog' then 'orange' else 'violet' end),
         g.workspace_id
  from public.error_groups g
  join public.error_sources s on s.id = g.source_id
  where g.issue_id is not null
  on conflict do nothing;
  perform set_config('devdock.via', '', true);
end;
$$;
