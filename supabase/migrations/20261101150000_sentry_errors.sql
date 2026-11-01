-- Error tracking: Sentry (owner's choice, 2026-11-01), pulled once a day with a personal auth token
-- (event:read, project:read, org:read) from the organization issues API.
--
-- Sentry reports how many times an issue happened on each day (absolute numbers for the last 14 days)
-- and its lifetime total, not "since the last sync". So a report may now say:
--   "days_mode": "set"   each day's count is the day's whole count: only the increase over what Calsko
--                        already has for that day is added to the total (re-reading a day adds nothing);
--   "total": n           the error's lifetime count in the tracker: Calsko's total is at least that.
-- Reports without them (PostHog, webhooks) are added as before.

alter table public.error_sources drop constraint error_sources_provider;
alter table public.error_sources add constraint error_sources_provider check (provider in ('posthog', 'webhook', 'sentry'));

create or replace function private.check_error_source_config(p_provider text, p_config jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_host text;
  v_project text;
  v_org text;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    p_config := '{}'::jsonb;
  end if;
  if p_provider = 'posthog' then
    v_host := coalesce(p_config ->> 'host', 'https://us.posthog.com');
    v_project := btrim(coalesce(p_config ->> 'project_id', ''));
    if v_host not in ('https://us.posthog.com', 'https://eu.posthog.com') then
      raise exception 'Choose PostHog US or EU Cloud' using errcode = '22023';
    end if;
    if v_project !~ '^[0-9]{1,12}$' then
      raise exception 'The PostHog project id is a number (Settings → Project → Project ID)' using errcode = '22023';
    end if;
    return jsonb_build_object('host', v_host, 'project_id', v_project);
  elsif p_provider = 'sentry' then
    v_host := coalesce(p_config ->> 'host', 'https://sentry.io');
    v_org := lower(btrim(coalesce(p_config ->> 'org', '')));
    v_project := lower(btrim(coalesce(p_config ->> 'project', '')));
    if v_host not in ('https://sentry.io', 'https://de.sentry.io') then
      raise exception 'Choose Sentry US (sentry.io) or EU (de.sentry.io)' using errcode = '22023';
    end if;
    if v_org !~ '^[a-z0-9][a-z0-9_-]{0,99}$' then
      raise exception 'The Sentry organization slug is the part before .sentry.io in its address' using errcode = '22023';
    end if;
    if v_project !~ '^[a-z0-9][a-z0-9_.-]{0,99}$' then
      raise exception 'The Sentry project slug is in the project''s address (…/projects/<slug>/)' using errcode = '22023';
    end if;
    return jsonb_build_object('host', v_host, 'org', v_org, 'project', v_project);
  elsif p_provider = 'webhook' then
    return '{}'::jsonb;
  end if;
  raise exception 'Unknown error tracker' using errcode = '22023';
end;
$$;

-- Pulled sources' labels are named after the tracker (posthog-errors, sentry-errors); webhooks after
-- their own name.
create or replace function private.error_source_label_name(p_provider text, p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_provider <> 'webhook' then p_provider || '-errors'
    else coalesce(
      nullif(left(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 33), ''),
      p_provider
    ) || '-errors'
  end;
$$;

-- Every pulled provider needs its key (not only PostHog).
create or replace function public.create_error_source(
  p_workspace_id uuid,
  p_provider text,
  p_name text,
  p_config jsonb default '{}'::jsonb,
  p_api_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_config jsonb;
  v_id uuid;
  v_token text;
  v_key_id uuid;
begin
  select w.team_id into v_team from public.workspaces w where w.id = p_workspace_id;
  if v_team is null or not private.can_manage_workspace(p_workspace_id) then
    raise exception 'Only the project''s leads and group owners/admins connect error trackers' using errcode = '42501';
  end if;
  if not private.feature_enabled(v_team, 'error_tracking') then
    raise exception 'Error tracking isn''t switched on for this group' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_modules m where m.workspace_id = p_workspace_id and m.module = 'issues') then
    raise exception 'Turn on Issues for this workspace first' using errcode = '22023';
  end if;
  if (select count(*) from public.error_sources s where s.workspace_id = p_workspace_id) >= 10 then
    raise exception 'A project can have at most 10 error sources' using errcode = '22023';
  end if;

  v_config := private.check_error_source_config(p_provider, p_config);
  if p_provider <> 'webhook' and char_length(btrim(coalesce(p_api_key, ''))) not between 8 and 300 then
    raise exception '%', case p_provider
      when 'posthog' then 'Paste a PostHog personal API key'
      when 'sentry' then 'Paste a Sentry personal auth token'
      else 'Paste the API key' end
      using errcode = '22023';
  end if;

  insert into public.error_sources (team_id, workspace_id, provider, name, config, created_by)
  values (v_team, p_workspace_id, p_provider, btrim(p_name), v_config, (select auth.uid()))
  returning id into v_id;

  if p_provider = 'webhook' then
    v_token := private.random_token();
    insert into private.error_source_secrets (source_id, token_hash)
    values (v_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  else
    v_key_id := vault.create_secret(btrim(p_api_key), 'error_source_' || v_id::text, 'Error source API key');
    insert into private.error_source_secrets (source_id, api_key_id) values (v_id, v_key_id);
  end if;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- Records reports for a source. p_reports: an array (at most 500) of
--   { fingerprint, title, raw?, url?, first_seen?, last_seen?, days: [{ day: 'YYYY-MM-DD', count }],
--     days_mode?: 'add' (default) | 'set', total? }
-- Returns { recorded, flagged }.
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
      (team_id, workspace_id, source_id, fingerprint, title, raw, url, first_seen, last_seen, total_count)
    values (
      v_source.team_id, v_source.workspace_id, p_source,
      v_report ->> 'fingerprint',
      left(btrim(v_report ->> 'title'), 300),
      left(coalesce(v_report ->> 'raw', ''), 20000),
      case when (v_report ->> 'url') ~ '^https://' then left(v_report ->> 'url', 2000) end,
      v_first, v_last, greatest(v_sum, coalesce(v_total, 0))
    )
    on conflict (source_id, fingerprint) do update set
      title = excluded.title,
      raw = case when excluded.raw <> '' then excluded.raw else g.raw end,
      url = coalesce(excluded.url, g.url),
      first_seen = least(g.first_seen, excluded.first_seen),
      last_seen = greatest(g.last_seen, excluded.last_seen),
      total_count = greatest(g.total_count + v_sum, coalesce(v_total, 0))
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
