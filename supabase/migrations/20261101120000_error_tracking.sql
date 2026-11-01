-- Error tracking (owner's choice, 2026-11-01): errors from an error tracker (PostHog first; Sentry,
-- Rollbar, Datadog, CloudWatch and others later) become issues in a project, written by AI, with the
-- exact error copied below. The same error happening again only adds to its count while its issue is
-- open; an error that comes back after its issue was Done gets a new issue that points at the old one;
-- a Canceled issue means "won't fix", so its error is only counted.
--
-- How it works:
-- - A project lead or group owner/admin connects an **error source** to a project (Project settings →
--   Error tracking): a provider, its non-secret settings (`config`) and its secret. The API key (pulled
--   sources) is kept in Supabase Vault; the webhook token (pushed sources) only as a SHA-256 hash. The
--   browser never reads either back.
-- - Errors arrive two ways, both as "error reports" (one per kind of error, never one per occurrence):
--     · pushed: the `error-intake` Edge Function receives a webhook and calls error_record();
--     · pulled: once a day the `error-sync` Edge Function asks the provider's API for what happened
--       since the last sync and calls error_record() too.
--   error_record() keeps one row per kind of error (`error_groups`, by the provider's fingerprint) with
--   its counts per day (`error_group_days`), and flags the ones that need an issue.
-- - The daily job then writes those issues (AI when `error_tracking_ai` is on, a plain template
--   otherwise), at most 20 per source per run, through error_create_issue(). Activity shows them as
--   made by error tracking (`via = 'errors'`).
-- - Only the service role calls the error_* functions below; people manage sources through the
--   *_error_source RPCs, which check the caller.
--
-- Setup per project (by hand, like the email worker; see docs/ERROR_TRACKING.md):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/error-sync', 'error_sync_url');
--   select vault.create_secret('<random>', 'error_sync_secret');   -- = the function's ERROR_SYNC_SECRET
-- Without them nothing is pulled and no issues are written; webhooks are still counted.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------------------------------
-- Feature flags.

insert into public.feature_flags (key, description, default_enabled, details) values
  ('error_tracking', 'Error tracking: errors from PostHog (and later other trackers) become counted issues in a project.', false, $d$
On: project leads and group owners/admins see Project settings → Error tracking, where they connect PostHog or a webhook to a project.
Once a day Calsko collects each source's errors. A new kind of error becomes an issue (Backlog, labelled Error); the same error again only adds to its count.
An error that comes back after its issue was Done gets a new issue that points at the old one. A Canceled issue means "won't fix": its error is only counted.
Issues that came from an error show an Error block (how often, first and last seen, the last 14 days, a link back to the tracker).
At most 20 new issues per source per day; the rest wait for the next day.
Off: nothing is collected or created for the group, webhooks are refused, and the settings section is hidden. Existing issues stay.
$d$);
insert into public.feature_flags (key, parent, description, default_enabled, details) values
  ('error_tracking_ai', 'error_tracking', 'AI writes the issues for new errors (title, what is happening, likely cause, where to look).', true, $d$
On: each new error's issue is written by Google's Gemini model from the error, its stack trace, the page and how often it happened. The exact error is always copied below what the AI wrote.
The AI runs once per new issue, never per occurrence. If it fails, the issue is written from a plain template instead.
Off: issues are written from the plain template (the error message as the title, the exact error as the description). Nothing is sent to the model.
$d$);

-- ---------------------------------------------------------------------------------------------------
-- Activity: issues made by error tracking say so (via = 'errors', no actor).

-- (issue_activity.via is free text; 'github' and now 'errors' are the values the app knows.)

-- ---------------------------------------------------------------------------------------------------
-- Sources.

create table public.error_sources (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null,
  workspace_id      uuid not null,
  provider          text not null,
  name              text not null,
  -- Non-secret settings, checked per provider by private.check_error_source_config().
  config            jsonb not null default '{}'::jsonb,
  enabled           boolean not null default true,
  -- The label new issues get; null = the project's "Error" label (made when missing).
  label_id          uuid,
  last_synced_at    timestamptz,
  last_sync_ok      boolean,
  last_sync_message text,
  -- "Sync now": at most once every 10 minutes per source.
  sync_requested_at timestamptz,
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint error_sources_workspace_fkey foreign key (workspace_id, team_id)
    references public.workspaces (id, team_id) on delete cascade,
  constraint error_sources_label_fkey foreign key (label_id, workspace_id)
    references public.issue_labels (id, workspace_id) on delete set null (label_id),
  constraint error_sources_provider check (provider in ('posthog', 'webhook')),
  constraint error_sources_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint error_sources_config_object check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 2000),
  constraint error_sources_message_length check (last_sync_message is null or char_length(last_sync_message) <= 300)
);

comment on table public.error_sources is 'An error tracker connected to a project. Secrets live in private.error_source_secrets.';

create index error_sources_workspace_idx on public.error_sources (workspace_id);
create index error_sources_team_idx on public.error_sources (team_id);
create index error_sources_label_idx on public.error_sources (label_id);
create index error_sources_created_by_idx on public.error_sources (created_by);

create trigger set_updated_at before update on public.error_sources
  for each row execute function public.set_updated_at();

alter table public.error_sources enable row level security;
revoke all on public.error_sources from anon, authenticated;
grant select, delete on public.error_sources to authenticated;
grant update (name, enabled, label_id) on public.error_sources to authenticated;

-- Only the project's managers see and change its sources (they hold its settings).
create policy "Managers read error sources" on public.error_sources
  for select to authenticated using ((select private.can_manage_workspace(workspace_id)));
create policy "Managers change error sources" on public.error_sources
  for update to authenticated
  using ((select private.can_manage_workspace(workspace_id)))
  with check ((select private.can_manage_workspace(workspace_id)));
create policy "Managers remove error sources" on public.error_sources
  for delete to authenticated using ((select private.can_manage_workspace(workspace_id)));

-- Secrets: never readable over the API.
create table private.error_source_secrets (
  source_id   uuid primary key references public.error_sources (id) on delete cascade,
  api_key_id  uuid,          -- vault.secrets id (pulled providers)
  token_hash  text           -- hex SHA-256 of the webhook token (pushed sources)
);
revoke all on table private.error_source_secrets from public, anon, authenticated;

-- Deleting a source deletes its Vault secret too.
create function private.forget_error_source_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.api_key_id is not null then
    delete from vault.secrets where id = old.api_key_id;
  end if;
  return null;
end;
$$;
revoke all on function private.forget_error_source_secret() from public, anon, authenticated;

create trigger forget_error_source_secret
  after delete on private.error_source_secrets
  for each row execute function private.forget_error_source_secret();

-- Per-provider settings. Hosts are fixed lists: the server fetches them, so no free-form URLs.
create function private.check_error_source_config(p_provider text, p_config jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_host text;
  v_project text;
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
  elsif p_provider = 'webhook' then
    return '{}'::jsonb;
  end if;
  raise exception 'Unknown error tracker' using errcode = '22023';
end;
$$;
revoke all on function private.check_error_source_config(text, jsonb) from public, anon, authenticated;

create function private.random_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'cerr_' || encode(extensions.gen_random_bytes(24), 'hex');
$$;
revoke all on function private.random_token() from public, anon, authenticated;

-- Connects a source. Managers of a project with Issues, in a group with error tracking on.
-- Returns { id, token } where token is the webhook token, shown once (null for pulled providers).
create function public.create_error_source(
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
  if p_provider = 'posthog' and char_length(btrim(coalesce(p_api_key, ''))) not between 8 and 300 then
    raise exception 'Paste a PostHog personal API key' using errcode = '22023';
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
revoke all on function public.create_error_source(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.create_error_source(uuid, text, text, jsonb, text) to authenticated;

-- Replaces a pulled source's settings and, when given, its API key.
create function public.update_error_source_connection(p_source_id uuid, p_config jsonb, p_api_key text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.error_sources;
  v_key_id uuid;
begin
  select * into v_source from public.error_sources s where s.id = p_source_id;
  if v_source.id is null or not private.can_manage_workspace(v_source.workspace_id) then
    raise exception 'Error source not found' using errcode = '42501';
  end if;
  update public.error_sources set config = private.check_error_source_config(v_source.provider, p_config)
  where id = p_source_id;
  if nullif(btrim(coalesce(p_api_key, '')), '') is not null and v_source.provider <> 'webhook' then
    if char_length(btrim(p_api_key)) not between 8 and 300 then
      raise exception 'That API key doesn''t look right' using errcode = '22023';
    end if;
    select x.api_key_id into v_key_id from private.error_source_secrets x where x.source_id = p_source_id;
    if v_key_id is null then
      v_key_id := vault.create_secret(btrim(p_api_key), 'error_source_' || p_source_id::text, 'Error source API key');
      insert into private.error_source_secrets (source_id, api_key_id) values (p_source_id, v_key_id)
      on conflict (source_id) do update set api_key_id = excluded.api_key_id;
    else
      perform vault.update_secret(v_key_id, btrim(p_api_key));
    end if;
  end if;
end;
$$;
revoke all on function public.update_error_source_connection(uuid, jsonb, text) from public, anon;
grant execute on function public.update_error_source_connection(uuid, jsonb, text) to authenticated;

-- A new webhook token (the old one stops working). Returns it, once.
create function public.rotate_error_source_token(p_source_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.error_sources;
  v_token text := private.random_token();
begin
  select * into v_source from public.error_sources s where s.id = p_source_id;
  if v_source.id is null or not private.can_manage_workspace(v_source.workspace_id) then
    raise exception 'Error source not found' using errcode = '42501';
  end if;
  if v_source.provider <> 'webhook' then
    raise exception 'Only webhook sources have a token' using errcode = '22023';
  end if;
  insert into private.error_source_secrets (source_id, token_hash)
  values (p_source_id, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (source_id) do update set token_hash = excluded.token_hash;
  return v_token;
end;
$$;
revoke all on function public.rotate_error_source_token(uuid) from public, anon;
grant execute on function public.rotate_error_source_token(uuid) to authenticated;

-- "Sync now", called as the person by the error-sync function before it syncs one source.
create function public.request_error_sync(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.error_sources;
begin
  select * into v_source from public.error_sources s where s.id = p_source_id;
  if v_source.id is null or not private.can_manage_workspace(v_source.workspace_id) then
    raise exception 'Error source not found' using errcode = '42501';
  end if;
  if not private.feature_enabled(v_source.team_id, 'error_tracking') then
    raise exception 'Error tracking isn''t switched on for this group' using errcode = '42501';
  end if;
  if v_source.sync_requested_at > now() - interval '10 minutes' then
    raise exception 'This source was synced a moment ago. Try again in a few minutes.' using errcode = 'DD010';
  end if;
  update public.error_sources set sync_requested_at = now() where id = p_source_id;
end;
$$;
revoke all on function public.request_error_sync(uuid) from public, anon;
grant execute on function public.request_error_sync(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Errors: one row per kind of error and source, with counts per day.

create table public.error_groups (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null,
  workspace_id      uuid not null,
  source_id         uuid not null references public.error_sources (id) on delete cascade,
  fingerprint       text not null,
  title             text not null,
  -- The exact error (message, stack, page, browser), from the latest report.
  raw               text not null default '',
  -- The error in the tracker, for "Open in PostHog".
  url               text,
  first_seen        timestamptz not null,
  last_seen         timestamptz not null,
  total_count       bigint not null default 0,
  issue_id          uuid references public.issues (id) on delete set null,
  -- The Done issue this error came back after.
  previous_issue_id uuid references public.issues (id) on delete set null,
  needs_issue       boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint error_groups_workspace_fkey foreign key (workspace_id, team_id)
    references public.workspaces (id, team_id) on delete cascade,
  constraint error_groups_fingerprint_length check (char_length(fingerprint) between 1 and 200),
  constraint error_groups_title_length check (char_length(title) between 1 and 300),
  constraint error_groups_raw_length check (char_length(raw) <= 20000),
  constraint error_groups_url_length check (url is null or (char_length(url) <= 2000 and url ~ '^https://')),
  constraint error_groups_source_fingerprint_key unique (source_id, fingerprint)
);

comment on table public.error_groups is 'One kind of error from an error source, with its issue. Written only by the error_* functions.';

-- One error per issue, so the issue page can embed it as a single object.
create unique index error_groups_issue_key on public.error_groups (issue_id) where issue_id is not null;
create index error_groups_previous_issue_idx on public.error_groups (previous_issue_id);
create index error_groups_workspace_idx on public.error_groups (workspace_id);
create index error_groups_team_idx on public.error_groups (team_id);
create index error_groups_pending_idx on public.error_groups (source_id, total_count desc) where needs_issue;

create trigger set_updated_at before update on public.error_groups
  for each row execute function public.set_updated_at();

alter table public.error_groups enable row level security;
revoke all on public.error_groups from anon, authenticated;
grant select on public.error_groups to authenticated;

create policy "People in the project read its errors" on public.error_groups
  for select to authenticated using ((select private.can_view_workspace(workspace_id)));

create table public.error_group_days (
  group_id uuid not null references public.error_groups (id) on delete cascade,
  day      date not null,
  count    integer not null check (count >= 0),
  primary key (group_id, day)
);

comment on table public.error_group_days is 'How often an error happened each day (UTC). Kept 90 days.';

alter table public.error_group_days enable row level security;
revoke all on public.error_group_days from anon, authenticated;
grant select on public.error_group_days to authenticated;

create policy "People in the project read error counts" on public.error_group_days
  for select to authenticated using (
    exists (select 1 from public.error_groups g where g.id = group_id and (select private.can_view_workspace(g.workspace_id)))
  );

-- ---------------------------------------------------------------------------------------------------
-- The service role's side: what the Edge Functions call.

-- Sources to sync: enabled, in groups with the flag on. p_source narrows it to one ("Sync now").
create function public.error_sources_due(p_source uuid default null)
returns table (
  id uuid,
  team_id uuid,
  workspace_id uuid,
  provider text,
  name text,
  config jsonb,
  last_synced_at timestamptz,
  ai boolean,
  issue_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.team_id, s.workspace_id, s.provider, s.name, s.config, s.last_synced_at,
         private.feature_enabled(s.team_id, 'error_tracking_ai'), w.issue_key
  from public.error_sources s
  join public.workspaces w on w.id = s.workspace_id
  where s.enabled
    and private.feature_enabled(s.team_id, 'error_tracking')
    and (p_source is null or s.id = p_source)
  order by s.created_at;
$$;
revoke all on function public.error_sources_due(uuid) from public, anon, authenticated;
grant execute on function public.error_sources_due(uuid) to service_role;

create function public.error_source_api_key(p_source uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
  from private.error_source_secrets x
  join vault.decrypted_secrets d on d.id = x.api_key_id
  where x.source_id = p_source;
$$;
revoke all on function public.error_source_api_key(uuid) from public, anon, authenticated;
grant execute on function public.error_source_api_key(uuid) to service_role;

-- The webhook's check: the token matches, the source is on and the group has error tracking.
create function public.error_source_for_token(p_source uuid, p_token text)
returns table (id uuid, provider text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.provider
  from public.error_sources s
  join private.error_source_secrets x on x.source_id = s.id
  where s.id = p_source
    and s.enabled
    and x.token_hash is not null
    and x.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and private.feature_enabled(s.team_id, 'error_tracking');
$$;
revoke all on function public.error_source_for_token(uuid, text) from public, anon, authenticated;
grant execute on function public.error_source_for_token(uuid, text) to service_role;

-- Records reports for a source. p_reports: an array (at most 500) of
--   { fingerprint, title, raw?, url?, first_seen?, last_seen?, days: [{ day: 'YYYY-MM-DD', count }] }
-- Counts are added (each report covers occurrences not reported before). Returns { recorded, flagged }.
create function public.error_record(p_source uuid, p_reports jsonb)
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
    returning * into v_group;

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
    elsif v_group.created_at = v_group.updated_at then
      v_flagged := v_flagged + 1;
    end if;
    v_recorded := v_recorded + 1;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'flagged', v_flagged);
end;
$$;
revoke all on function public.error_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.error_record(uuid, jsonb) to service_role;

-- The errors of a source that need an issue, most frequent first.
create function public.error_groups_needing_issues(p_source uuid, p_limit integer default 20)
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
  where g.source_id = p_source and g.needs_issue
  order by g.total_count desc, g.last_seen desc
  limit least(greatest(p_limit, 0), 50);
$$;
revoke all on function public.error_groups_needing_issues(uuid, integer) from public, anon, authenticated;
grant execute on function public.error_groups_needing_issues(uuid, integer) to service_role;

-- Makes the issue for an error. p_priority 0–4 (as issues.priority). Returns the issue's number.
create function public.error_create_issue(p_group uuid, p_title text, p_description jsonb, p_priority integer default 0)
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
  insert into public.issues (workspace_id, title, description, status, priority)
  values (
    v_group.workspace_id,
    left(coalesce(nullif(btrim(p_title), ''), v_group.title), 200),
    p_description,
    'backlog',
    case when p_priority between 0 and 4 then p_priority else 0 end
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
revoke all on function public.error_create_issue(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.error_create_issue(uuid, text, jsonb, integer) to service_role;

create function public.error_finish_sync(p_source uuid, p_ok boolean, p_message text, p_synced_until timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.error_sources
  set last_sync_ok = p_ok,
      last_sync_message = left(p_message, 300),
      last_synced_at = case when p_ok and p_synced_until is not null then p_synced_until else last_synced_at end
  where id = p_source;
$$;
revoke all on function public.error_finish_sync(uuid, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.error_finish_sync(uuid, boolean, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- The daily run: pg_cron → pg_net → error-sync, only when a source is due.

create function private.kick_error_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  delete from public.error_group_days where day < current_date - 90;
  if not exists (
    select 1 from public.error_sources s
    where s.enabled and private.feature_enabled(s.team_id, 'error_tracking')
  ) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'error_sync_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'error_sync_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function private.kick_error_sync() from public, anon, authenticated;

select cron.schedule('error-sync-daily', '0 6 * * *', 'select private.kick_error_sync()');
