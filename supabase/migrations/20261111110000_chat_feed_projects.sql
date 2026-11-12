-- Chat feeds: projects that only some people can see may post too, when a group owner or admin ticks
-- them (owner's choice, 2026-11-08: most projects are members-only, so "open to the whole group" alone
-- left the events feed nearly silent). Ticking one means its issue titles and meetings are shown to
-- everyone who can read the channel; the settings say so.

alter table public.chat_feeds add column projects uuid[] not null default '{}';
grant update (projects) on public.chat_feeds to authenticated;

-- Whether this feed posts about this project: open to the whole group, or ticked in the feed.
create function private.chat_feed_covers(p_feed uuid, p_workspace uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w
      join public.chat_feeds f on f.id = p_feed and f.team_id = w.team_id
     where w.id = p_workspace and (w.access = 'group' or w.id = any(f.projects)));
$$;
revoke all on function private.chat_feed_covers(uuid, uuid) from public, anon, authenticated;

-- The group's events feed, when it's on.
create function private.events_feed(p_team uuid)
returns uuid
language sql
stable security definer
set search_path = ''
as $$
  select f.id from public.chat_feeds f where f.team_id = p_team and f.kind = 'events' and f.enabled;
$$;
revoke all on function private.events_feed(uuid) from public, anon, authenticated;

create or replace function private.chat_issue_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces;
  v_slug text;
  v_key text;
  v_link text;
begin
  -- Error tracking's issues come in its own summary; imports would flood the channel.
  if coalesce(current_setting('devdock.via', true), '') = 'errors' then return null; end if;
  if tg_op = 'INSERT' and new.import_source is not null then return null; end if;
  if tg_op = 'UPDATE' and not (new.status in ('done', 'canceled') and old.status not in ('done', 'canceled')) then return null; end if;
  if not private.chat_feed_covers(private.events_feed(new.team_id), new.workspace_id) then return null; end if;

  select * into v_ws from public.workspaces w where w.id = new.workspace_id;
  select t.slug into v_slug from public.teams t where t.id = new.team_id;
  v_key := v_ws.issue_key || '-' || new.number;
  v_link := '/t/' || v_slug || '/w/' || v_ws.id || '/issues/' || new.number;

  if tg_op = 'INSERT' then
    perform private.chat_event(new.team_id, 'issue_created',
      private.chat_actor() || ' created ' || v_key, new.title,
      jsonb_build_object('name', 'Calsko', 'link', v_link, 'icon', 'issue'));
  else
    perform private.chat_event(new.team_id, 'issue_closed',
      private.chat_actor() || case when new.status = 'done' then ' completed ' else ' canceled ' end || v_key, new.title,
      jsonb_build_object('name', 'Calsko', 'link', v_link, 'icon', 'issue',
                         'level', case when new.status = 'done' then 'success' else 'info' end));
  end if;
  return null;
end;
$$;

create or replace function private.chat_meetings(p_op text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_slug text;
  v_repeat boolean;
begin
  for r in
    select distinct on (s.team_id, coalesce(s.series_id, s.id)) s.*
      from jsonb_populate_recordset(null::public.live_sessions, p_rows) s
     order by s.team_id, coalesce(s.series_id, s.id), s.starts_at
  loop
    continue when not private.has_events_feed(r.team_id);
    -- A project's meeting only when the feed covers the project (group-wide meetings always).
    continue when r.workspace_id is not null and not private.chat_feed_covers(private.events_feed(r.team_id), r.workspace_id);
    select t.slug into v_slug from public.teams t where t.id = r.team_id;
    continue when v_slug is null;
    v_repeat := r.series_id is not null;

    if p_op = 'INSERT' then
      -- New occurrences added to an existing series aren't news.
      continue when v_repeat and exists (
        select 1 from public.live_sessions s
         where s.series_id = r.series_id
           and not exists (select 1 from jsonb_array_elements(p_rows) n where (n ->> 'id')::uuid = s.id));
      perform private.chat_event(r.team_id, 'meeting_scheduled',
        private.chat_actor() || ' scheduled ' || case when v_repeat then 'a repeating meeting' else 'a meeting' end, r.title,
        jsonb_build_object('name', 'Calsko', 'icon', 'meeting', 'at', r.starts_at, 'link', '/t/' || v_slug || '/live/' || r.id));
    else
      perform private.chat_event(r.team_id, 'meeting_cancelled',
        private.chat_actor() || ' cancelled ' || case
          when v_repeat and exists (select 1 from public.live_sessions s where s.series_id = r.series_id) then 'one meeting of a series'
          when v_repeat then 'a repeating meeting'
          else 'a meeting' end, r.title,
        jsonb_build_object('name', 'Calsko', 'icon', 'meeting', 'at', r.starts_at));
    end if;
  end loop;
end;
$$;

create or replace function public.chat_post_error_summary(p_source uuid, p_ok boolean, p_errors integer, p_issues integer, p_since timestamptz, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.error_sources;
  v_ws public.workspaces;
  v_feed uuid;
  v_slug text;
  v_list text;
  v_title text;
begin
  select * into v_source from public.error_sources s where s.id = p_source;
  if v_source.id is null then return; end if;
  select f.id into v_feed from public.chat_feeds f where f.team_id = v_source.team_id and f.kind = 'errors' and f.enabled;
  -- Only projects the feed covers: their issue titles reach everyone who reads the channel.
  if v_feed is null or not private.chat_feed_covers(v_feed, v_source.workspace_id) then return; end if;
  if p_ok and coalesce(p_errors, 0) = 0 and coalesce(p_issues, 0) = 0 then return; end if;
  select * into v_ws from public.workspaces w where w.id = v_source.workspace_id;
  select t.slug into v_slug from public.teams t where t.id = v_source.team_id;

  select string_agg(v_ws.issue_key || '-' || i.number || ' · ' || i.title, E'\n' order by i.number)
    into v_list
    from (select i.number, i.title from public.issues i
            join public.error_groups g on g.issue_id = i.id
           where g.source_id = p_source and i.created_at >= p_since
           order by i.number limit 10) i;

  if not p_ok then
    v_title := v_source.name || ': the sync failed';
  else
    v_title := v_source.name || ': '
      || case when p_errors > 0 then p_errors || case when p_errors = 1 then ' kind of error seen, ' else ' kinds of error seen, ' end else '' end
      || coalesce(p_issues, 0) || case when p_issues = 1 then ' new issue' else ' new issues' end;
  end if;

  perform private.chat_post(v_feed, v_title,
    case when not p_ok then p_message
         when v_list is not null then v_list || case when p_issues > 10 then E'\n…and ' || (p_issues - 10) || ' more' else '' end
         else null end,
    jsonb_build_object('name', 'Error tracking', 'icon', 'errors',
      'level', case when not p_ok or p_issues > 0 then 'warning' else 'info' end,
      'link', '/t/' || v_slug || '/w/' || v_ws.id || '/issues'));
end;
$$;

-- A feed posts into a live channel of its own group, about its own projects.
create or replace function private.check_chat_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.team_id = new.team_id and c.kind = 'channel' and not c.is_archived
  ) then
    raise exception 'Choose a channel of this group' using errcode = '22023';
  end if;
  -- Only the group's own projects; one deleted since simply drops out.
  new.projects := array(select distinct p from unnest(new.projects) p
                         where exists (select 1 from public.workspaces w where w.id = p and w.team_id = new.team_id));
  new.name := btrim(new.name);
  return new;
end;
$$;
drop trigger check_chat_feed on public.chat_feeds;
create trigger check_chat_feed before insert or update of conversation_id, name, projects on public.chat_feeds
  for each row execute function private.check_chat_feed();
