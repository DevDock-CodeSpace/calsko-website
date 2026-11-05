-- An error becomes an issue only once it's worth one.
--
-- Since PostHog went live, most error issues weren't bugs: one laptop losing its session made every
-- query on the open page fail at once, one issue per table (17 from one minute on 2026-11-01), and
-- one-off network drops each got an issue too. Now a new error is counted from its first report, but
-- error-sync only writes its issue once it has reached at least 2 people, or happened on 2 different
-- days. A burst from one person on one day stays a counted error without an issue.
-- Not held back: an error back after its issue was Done (it already earned one), and webhook sources
-- (they send a tool's alerts, already filtered there).
--
-- `people` is the most people one report said the error reached (PostHog: distinct people in the
-- sync's window; Sentry: its user count). Sources that don't say leave it at 0 and rely on the days.

alter table public.error_groups
  add column people integer not null default 0;

comment on column public.error_groups.people is
  'The most people one report said this error reached (0 = the source doesn''t say). With the days, decides when it is worth an issue.';

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
  v_set boolean;
  v_total bigint;
  v_people integer;
  v_existing uuid;
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

    v_set := (v_report ->> 'days_mode') = 'set';
    v_total := case when (v_report ->> 'total') ~ '^\d{1,15}$' then (v_report ->> 'total')::bigint end;
    v_people := case when (v_report ->> 'people') ~ '^\d{1,9}$' then (v_report ->> 'people')::integer else 0 end;
    select g.id into v_existing from public.error_groups g where g.source_id = p_source and g.fingerprint = v_report ->> 'fingerprint';

    -- Days: valid dates within the last 90 days, positive counts, at most 31 of them.
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', d.count)), '[]'::jsonb),
           coalesce(sum(case when v_set then greatest(d.count - coalesce(old.count, 0), 0) else d.count end), 0)
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
    ) d
    left join public.error_group_days old on old.group_id = v_existing and old.day = d.day;
    continue when v_sum = 0 and (v_total is null or v_existing is not null);

    v_last := least(coalesce(nullif(v_report ->> 'last_seen', '')::timestamptz, now()), now());
    v_first := least(coalesce(nullif(v_report ->> 'first_seen', '')::timestamptz, v_last), v_last);

    insert into public.error_groups as g
      (team_id, workspace_id, source_id, fingerprint, title, raw, url, first_seen, last_seen, total_count, people)
    values (
      v_source.team_id, v_source.workspace_id, p_source,
      v_report ->> 'fingerprint',
      left(btrim(v_report ->> 'title'), 300),
      left(coalesce(v_report ->> 'raw', ''), 20000),
      case when (v_report ->> 'url') ~ '^https://' then left(v_report ->> 'url', 2000) end,
      v_first, v_last, greatest(v_sum, coalesce(v_total, 0)), v_people
    )
    on conflict (source_id, fingerprint) do update set
      title = excluded.title,
      raw = case when excluded.raw <> '' then excluded.raw else g.raw end,
      url = coalesce(excluded.url, g.url),
      first_seen = least(g.first_seen, excluded.first_seen),
      last_seen = greatest(g.last_seen, excluded.last_seen),
      total_count = greatest(g.total_count + v_sum, coalesce(v_total, 0)),
      people = greatest(g.people, excluded.people)
    returning g.id, (g.xmax = 0) into v_group_id, v_inserted;
    select * into v_group from public.error_groups g where g.id = v_group_id;

    insert into public.error_group_days as d (group_id, day, count)
    select v_group.id, (e ->> 'day')::date, (e ->> 'count')::integer from jsonb_array_elements(v_days) e
    on conflict (group_id, day) do update set count = case
      when v_set then greatest(d.count, excluded.count)
      else least(d.count::bigint + excluded.count, 2000000000)::integer
    end;

    -- Does it need an issue? New (none yet, or its issue was deleted), or back after Done.
    if not v_group.needs_issue then
      if v_group.issue_id is null then
        update public.error_groups set needs_issue = true where id = v_group.id;
        v_flagged := v_flagged + 1;
      elsif v_sum > 0 then
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


-- Same columns as before; only errors worth an issue (see the top of this file).
create or replace function public.error_groups_needing_issues(p_source uuid, p_limit integer default 20)
returns table (
  id uuid,
  fingerprint text,
  title text,
  raw text,
  url text,
  first_seen timestamptz,
  last_seen timestamptz,
  total_count bigint,
  previous_issue_number integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.fingerprint, g.title, g.raw, g.url, g.first_seen, g.last_seen, g.total_count,
         (select i.number from public.issues i where i.id = g.issue_id)
  from public.error_groups g
  join public.error_sources s on s.id = g.source_id
  where g.source_id = p_source
    and g.needs_issue
    and (
      g.issue_id is not null -- back after Done
      or s.provider = 'webhook'
      or g.people >= 2
      or (select count(*) from public.error_group_days d where d.group_id = g.id) >= 2
    )
  order by g.total_count desc, g.last_seen desc
  limit least(greatest(p_limit, 0), 50);
$$;
