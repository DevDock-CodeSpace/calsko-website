-- Chat feeds, who sees them (owner's choice, 2026-11-08):
--   · a feed may post into a private group conversation (chosen people), not only a channel (the whole
--     group). Only into conversations the person setting it up is in;
--   · each kind of Calsko event may go somewhere else than the feed's own target (`event_targets`);
--   · a project only some people can see posts into a private conversation without being ticked when
--     everyone in that conversation can see the project;
--   · critical alerts notify the people who can read the target, not the whole group.

alter table public.chat_feeds add column event_targets jsonb not null default '{}'
  check (jsonb_typeof(event_targets) = 'object');
grant update (event_targets) on public.chat_feeds to authenticated;

-- Whether someone can see a project (private.workspace_role's rules, for any person rather than the caller).
create function private.user_can_view_workspace(p_user uuid, p_workspace uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w
     where w.id = p_workspace
       and (exists (select 1 from public.team_members tm
                     where tm.team_id = w.team_id and tm.user_id = p_user and tm.role in ('owner', 'admin'))
            or exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = p_user)
            or (w.access = 'group' and exists (select 1 from public.team_members tm where tm.team_id = w.team_id and tm.user_id = p_user))
            or (w.access = 'collection' and exists (select 1 from public.workspace_collection_members cm
                                                     where cm.collection_id = w.collection_id and cm.user_id = p_user))));
$$;
revoke all on function private.user_can_view_workspace(uuid, uuid) from public, anon, authenticated;

-- A place a feed may post: a live channel or private group conversation of the group. A private one only
-- when the person choosing it is in it (no one picks a conversation they can't read; the server's own
-- writes have no caller).
create function private.chat_target_ok(p_team uuid, p_conversation uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation and c.team_id = p_team and not c.is_archived
       and (c.kind = 'channel'
            or (c.kind = 'group' and ((select auth.uid()) is null or exists (
                  select 1 from public.conversation_members cm
                   where cm.conversation_id = c.id and cm.user_id = (select auth.uid()) and cm.left_at is null)))));
$$;
revoke all on function private.chat_target_ok(uuid, uuid) from public, anon, authenticated;

create or replace function private.check_chat_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if (tg_op = 'INSERT' or new.conversation_id is distinct from old.conversation_id)
     and not private.chat_target_ok(new.team_id, new.conversation_id) then
    raise exception 'Choose a channel or conversation of this group' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(new.event_targets) loop
    if v_key <> all (array['issue_created', 'issue_closed', 'meeting_scheduled', 'meeting_cancelled', 'plan_created', 'member_joined'])
       or jsonb_typeof(v_value) <> 'string' then
      raise exception 'Unknown event' using errcode = '22023';
    end if;
    if (tg_op = 'INSERT' or old.event_targets -> v_key is distinct from v_value)
       and not private.chat_target_ok(new.team_id, (v_value #>> '{}')::uuid) then
      raise exception 'Choose a channel or conversation of this group' using errcode = '22023';
    end if;
  end loop;
  -- Only the group's own projects; one deleted since simply drops out.
  new.projects := array(select distinct p from unnest(new.projects) p
                         where exists (select 1 from public.workspaces w where w.id = p and w.team_id = new.team_id));
  new.name := btrim(new.name);
  return new;
end;
$$;
drop trigger check_chat_feed on public.chat_feeds;
create trigger check_chat_feed before insert or update of conversation_id, name, projects, event_targets on public.chat_feeds
  for each row execute function private.check_chat_feed();

-- Where a feed posts this event: its own target for it if that's still usable, else the feed's.
create function private.chat_target(p_feed public.chat_feeds, p_event text)
returns uuid
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  if p_event is not null then
    begin
      v_target := (p_feed.event_targets ->> p_event)::uuid;
    exception when others then
      v_target := null;
    end;
  end if;
  if v_target is not null and exists (
      select 1 from public.conversations c
       where c.id = v_target and c.team_id = p_feed.team_id and not c.is_archived and c.kind in ('channel', 'group')) then
    return v_target;
  end if;
  return p_feed.conversation_id;
end;
$$;
revoke all on function private.chat_target(public.chat_feeds, text) from public, anon, authenticated;

-- Whether a message about this project may go to this target: the project is open to the whole group, an
-- admin ticked it in the feed, or the target is a private conversation whose people can all see it.
create function private.chat_target_covers(p_feed uuid, p_conversation uuid, p_workspace uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspaces w where w.id = p_workspace and w.access = 'group')
      or exists (select 1 from public.chat_feeds f where f.id = p_feed and p_workspace = any(f.projects))
      or (exists (select 1 from public.conversations c where c.id = p_conversation and c.kind = 'group')
          and not exists (select 1 from public.conversation_members cm
                           where cm.conversation_id = p_conversation and cm.left_at is null
                             and not private.user_can_view_workspace(cm.user_id, p_workspace)));
$$;
revoke all on function private.chat_target_covers(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Posting into the target.

drop function private.chat_insert(public.chat_feeds, text, text, jsonb);
create function private.chat_insert(p_feed public.chat_feeds, p_conversation uuid, p_title text, p_text text, p_bot jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := left(btrim(coalesce(p_title, '')), 300);
  v_text text := left(btrim(coalesce(p_text, '')), 4000);
  v_bot jsonb := jsonb_strip_nulls(coalesce(p_bot, '{}'::jsonb) || jsonb_build_object(
    'feed_id', p_feed.id, 'kind', p_feed.kind,
    'name', coalesce(nullif(p_bot ->> 'name', ''), p_feed.name),
    'level', coalesce(nullif(p_bot ->> 'level', ''), 'info')));
  v_kind text;
  v_id uuid;
begin
  if v_title = '' and v_text = '' then v_title := 'Alert'; end if;
  insert into public.messages (conversation_id, team_id, author_id, client_id, body, content, bot)
  values (p_conversation, p_feed.team_id, null, gen_random_uuid(),
          private.chat_doc(v_title, v_text),
          left(concat_ws(E'\n', nullif(v_title, ''), nullif(v_text, '')), 20000),
          v_bot)
  returning id into v_id;

  -- Critical: everyone who can read it (the group for a channel, the people in a private conversation).
  if v_bot ->> 'level' = 'critical' then
    select c.kind into v_kind from public.conversations c where c.id = p_conversation;
    insert into public.notifications (team_id, recipient_id, conversation_id, message_id, kind, dedupe_key)
    select p_feed.team_id, r.user_id, p_conversation, v_id, 'alert', 'alert:' || v_id::text
      from (select tm.user_id from public.team_members tm where v_kind = 'channel' and tm.team_id = p_feed.team_id
            union
            select cm.user_id from public.conversation_members cm
             where v_kind <> 'channel' and cm.conversation_id = p_conversation and cm.left_at is null) r
     where not exists (select 1 from public.conversation_preferences cp
                        where cp.conversation_id = p_conversation and cp.user_id = r.user_id
                          and cp.notification_mode = 'muted')
    on conflict (recipient_id, dedupe_key) do nothing;
  end if;
  return v_id;
end;
$$;
revoke all on function private.chat_insert(public.chat_feeds, uuid, text, text, jsonb) from public, anon, authenticated;

drop function private.chat_post(uuid, text, text, jsonb);
create function private.chat_post(p_feed uuid, p_title text, p_text text, p_bot jsonb default '{}', p_conversation uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feed public.chat_feeds;
  v_target uuid;
  v_limit integer;
  v_hour timestamptz := date_trunc('hour', now());
  v_win private.chat_feed_windows;
  v_id uuid;
begin
  select * into v_feed from public.chat_feeds f where f.id = p_feed and f.enabled;
  if v_feed.id is null
     or not exists (select 1 from public.teams t where t.id = v_feed.team_id)
     or not private.feature_enabled(v_feed.team_id, 'chat_feeds') then
    return null;
  end if;
  v_target := coalesce(p_conversation, v_feed.conversation_id);
  if not exists (select 1 from public.conversations c where c.id = v_target and c.team_id = v_feed.team_id and not c.is_archived) then
    return null;
  end if;
  v_limit := case v_feed.kind when 'webhook' then 60 else 200 end;

  insert into private.chat_feed_windows (feed_id, window_start) values (v_feed.id, v_hour)
  on conflict (feed_id) do nothing;
  select * into v_win from private.chat_feed_windows w where w.feed_id = v_feed.id for update;

  if v_win.window_start < v_hour then
    if v_win.held > 0 then
      perform private.chat_insert(v_feed, v_feed.conversation_id, null,
        v_win.held || case when v_win.held = 1 then ' message was' else ' messages were' end
          || ' held back in the last hour because this feed sent too many.', jsonb_build_object('level', 'warning'));
    end if;
    update private.chat_feed_windows set window_start = v_hour, posted = 0, held = 0 where feed_id = v_feed.id;
    v_win.posted := 0;
    v_win.held := 0;
  end if;

  if v_win.posted >= v_limit then
    if v_win.held = 0 then
      perform private.chat_insert(v_feed, v_feed.conversation_id, null,
        'Too many messages: the rest this hour are held back and counted.', jsonb_build_object('level', 'warning'));
    end if;
    update private.chat_feed_windows set held = held + 1 where feed_id = v_feed.id;
    return null;
  end if;

  v_id := private.chat_insert(v_feed, v_target, p_title, p_text, p_bot);
  update private.chat_feed_windows set posted = posted + 1 where feed_id = v_feed.id;
  update public.chat_feeds set last_posted_at = now() where id = v_feed.id;
  return v_id;
end;
$$;
revoke all on function private.chat_post(uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- An event, about a project (or the whole group: p_workspace null), for the group's events feed.
drop function private.chat_event(uuid, text, text, text, jsonb);
create function private.chat_event(p_team uuid, p_event text, p_workspace uuid, p_title text, p_text text, p_bot jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feed public.chat_feeds;
  v_target uuid;
begin
  select * into v_feed from public.chat_feeds f
   where f.team_id = p_team and f.kind = 'events' and f.enabled and p_event = any(f.events);
  if v_feed.id is null then return; end if;
  v_target := private.chat_target(v_feed, p_event);
  if p_workspace is not null and not private.chat_target_covers(v_feed.id, v_target, p_workspace) then return; end if;
  perform private.chat_post(v_feed.id, p_title, p_text, p_bot, v_target);
end;
$$;
revoke all on function private.chat_event(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The events, now deciding per target (chat_event) whether a project's news may go there.

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
  if not private.has_events_feed(new.team_id) then return null; end if;

  select * into v_ws from public.workspaces w where w.id = new.workspace_id;
  if v_ws.id is null then return null; end if;
  select t.slug into v_slug from public.teams t where t.id = new.team_id;
  v_key := v_ws.issue_key || '-' || new.number;
  v_link := '/t/' || v_slug || '/w/' || v_ws.id || '/issues/' || new.number;

  if tg_op = 'INSERT' then
    perform private.chat_event(new.team_id, 'issue_created', v_ws.id,
      private.chat_actor() || ' created ' || v_key, new.title,
      jsonb_build_object('name', 'Calsko', 'link', v_link, 'icon', 'issue'));
  else
    perform private.chat_event(new.team_id, 'issue_closed', v_ws.id,
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
    -- A project's meeting whose project is gone (the project is being deleted): nothing to say.
    continue when r.workspace_id is not null and not exists (select 1 from public.workspaces w where w.id = r.workspace_id);
    select t.slug into v_slug from public.teams t where t.id = r.team_id;
    continue when v_slug is null;
    v_repeat := r.series_id is not null;

    if p_op = 'INSERT' then
      -- New occurrences added to an existing series aren't news.
      continue when v_repeat and exists (
        select 1 from public.live_sessions s
         where s.series_id = r.series_id
           and not exists (select 1 from jsonb_array_elements(p_rows) n where (n ->> 'id')::uuid = s.id));
      perform private.chat_event(r.team_id, 'meeting_scheduled', r.workspace_id,
        private.chat_actor() || ' scheduled ' || case when v_repeat then 'a repeating meeting' else 'a meeting' end, r.title,
        jsonb_build_object('name', 'Calsko', 'icon', 'meeting', 'at', r.starts_at, 'link', '/t/' || v_slug || '/live/' || r.id));
    else
      perform private.chat_event(r.team_id, 'meeting_cancelled', r.workspace_id,
        private.chat_actor() || ' cancelled ' || case
          when v_repeat and exists (select 1 from public.live_sessions s where s.series_id = r.series_id) then 'one meeting of a series'
          when v_repeat then 'a repeating meeting'
          else 'a meeting' end, r.title,
        jsonb_build_object('name', 'Calsko', 'icon', 'meeting', 'at', r.starts_at));
    end if;
  end loop;
end;
$$;

create or replace function private.chat_plan_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  if not private.has_events_feed(new.team_id) then return null; end if;
  select t.slug into v_slug from public.teams t where t.id = new.team_id;
  perform private.chat_event(new.team_id, 'plan_created', null, private.chat_actor() || ' created a plan', new.name,
    jsonb_build_object('name', 'Calsko', 'icon', 'plan', 'link', '/t/' || v_slug || '/issues/plans/' || new.id));
  return null;
end;
$$;

create or replace function private.chat_member_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_events_feed(new.team_id) then return null; end if;
  perform private.chat_event(new.team_id, 'member_joined', null,
    coalesce((select p.display_name from public.profiles p where p.id = new.user_id), 'Someone') || ' joined the group', null,
    jsonb_build_object('name', 'Calsko', 'icon', 'member', 'level', 'success'));
  return null;
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
  v_feed public.chat_feeds;
  v_slug text;
  v_list text;
  v_title text;
begin
  select * into v_source from public.error_sources s where s.id = p_source;
  if v_source.id is null then return; end if;
  select * into v_feed from public.chat_feeds f where f.team_id = v_source.team_id and f.kind = 'errors' and f.enabled;
  -- Only where the project's issue titles may be read.
  if v_feed.id is null or not private.chat_target_covers(v_feed.id, v_feed.conversation_id, v_source.workspace_id) then return; end if;
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

  perform private.chat_post(v_feed.id, v_title,
    case when not p_ok then p_message
         when v_list is not null then v_list || case when p_issues > 10 then E'\n…and ' || (p_issues - 10) || ' more' else '' end
         else null end,
    jsonb_build_object('name', 'Error tracking', 'icon', 'errors',
      'level', case when not p_ok or p_issues > 0 then 'warning' else 'info' end,
      'link', '/t/' || v_slug || '/w/' || v_ws.id || '/issues'));
end;
$$;

-- Replaced by chat_target_covers / chat_event.
drop function private.chat_feed_covers(uuid, uuid);
drop function private.events_feed(uuid);
