-- Chat feeds (owner's choice, 2026-11-08): bots that post into a group's channels, like a Slack or Teams
-- channel that apps and alarms write to. See docs/CHAT_FEEDS.md.
--
-- A feed (`chat_feeds`) posts into one channel. Three kinds:
--   · events:  what happens in Calsko (issue created/closed, meeting scheduled/cancelled, plan created,
--              someone joined). Posted by triggers, in the same transaction as the change. One per group.
--   · errors:  error tracking's daily summary per source (errors seen, issues written). One per group.
--   · webhook: anything outside (AWS CloudWatch via SNS, Azure Monitor, Slack-style tools, curl) posting
--              to the chat-intake Edge Function with the feed's secret token. Many per group.
--
-- A bot message has no author (`author_id` null) and says who posted it in `bot`
-- ({ feed_id, kind, name, level, link?, url?, at? }). Only the functions below write them, and only into
-- channels. Events only mention things everyone in the group can see: issues of projects open to the
-- whole group (`access = 'group'`), group-wide meetings and meetings of such projects, plans, members.
--
-- Each feed posts at most 60 (webhooks) or 200 (events, errors) messages per clock hour; after that one
-- notice says the rest are held back, and the next hour starts with how many were.
-- Critical alerts (level 'critical') also notify everyone in the group who hasn't muted the channel.
--
-- Everything is behind the `chat_feeds` flag (off by default); the functions check it themselves.

insert into public.feature_flags (key, description, default_enabled, details) values
  ('chat_feeds', 'Chat feeds: Calsko events, error tracking summaries and outside alarms (AWS, Azure, any webhook) post into a chat channel.', false, $d$
On: group owners and admins see Group settings → Chat feeds. They choose which channel gets Calsko events (issues created or closed, meetings scheduled or cancelled, plans created, people joining), error tracking's daily summary, and messages from webhooks.
A webhook gets a secret URL that AWS CloudWatch (through SNS), Azure Monitor, tools that post to Slack, or any script can send to. Critical alarms also notify everyone in the group.
Each feed posts at most 60 (webhooks) or 200 (events) messages an hour; the rest are counted and held back.
Off: nothing is posted, webhooks are refused, and the settings section is hidden. Messages already posted stay.
$d$);

-- ---------------------------------------------------------------------------------------------------
-- Bot messages: no author, a `bot` description instead.

alter table public.messages alter column author_id drop not null;
alter table public.messages add column bot jsonb;
alter table public.messages add constraint messages_author_or_bot
  check ((author_id is null) <> (bot is null) and (bot is null or jsonb_typeof(bot) = 'object'));

-- Bot messages count as unread like anyone else's (author_id <> me is null for them).
create or replace function public.conversation_unread_counts(p_team_id uuid)
returns table(conversation_id uuid, unread_count integer, mention_count integer)
language sql
stable security definer
set search_path = ''
as $$
  with mine as (
    select c.id,
           coalesce(r.last_message_at, cm.joined_at, '-infinity'::timestamptz) as since
      from public.conversations c
      left join public.conversation_members cm
        on cm.conversation_id = c.id and cm.user_id = (select auth.uid()) and cm.left_at is null
      left join public.conversation_reads r
        on r.conversation_id = c.id and r.user_id = (select auth.uid())
     where c.team_id = p_team_id
       and not c.is_archived
       and private.can_read_conversation(c.id)
  )
  select mine.id,
         count(m.id)::integer,
         count(mm.message_id)::integer
    from mine
    left join public.messages m
      on m.conversation_id = mine.id
     and m.parent_id is null
     and m.deleted_at is null
     and m.author_id is distinct from (select auth.uid())
     and m.created_at > mine.since
     and private.can_read_message(m.id, m.conversation_id, m.created_at)
    left join public.message_mentions mm
      on mm.message_id = m.id and mm.mentioned_user_id = (select auth.uid())
   group by mine.id;
$$;

-- Group owners and admins may delete bot messages too (a noisy alarm), besides authors their own.
create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages m
     set content = '[deleted]',
         body = '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
         deleted_at = now()
   where m.id = p_message_id
     and (m.author_id = (select auth.uid()) or (m.bot is not null and private.is_team_admin(m.team_id)))
     and m.deleted_at is null
     and private.can_read_message(m.id, m.conversation_id, m.created_at);
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
  delete from public.message_pins where message_id = p_message_id;
  delete from public.message_reactions where message_id = p_message_id;
  delete from public.message_attachments where message_id = p_message_id;
end;
$$;

-- Critical alerts notify (kind 'alert'; never emailed: chat emails take mention/message/thread only).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'message', 'thread', 'call', 'reminder', 'alert'));

-- ---------------------------------------------------------------------------------------------------
-- Feeds.

create table public.chat_feeds (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  conversation_id uuid not null,
  kind            text not null check (kind in ('events', 'errors', 'webhook')),
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  enabled         boolean not null default true,
  -- events: which ones it posts.
  events          text[] not null default '{}',
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  last_posted_at  timestamptz,
  constraint chat_feeds_conversation_fkey
    foreign key (conversation_id, team_id) references public.conversations(id, team_id) on delete cascade,
  constraint chat_feeds_events_known check (events <@ array[
    'issue_created', 'issue_closed', 'meeting_scheduled', 'meeting_cancelled', 'plan_created', 'member_joined']::text[])
);
create unique index chat_feeds_one_per_team_idx on public.chat_feeds (team_id, kind) where kind in ('events', 'errors');
create index chat_feeds_team_idx on public.chat_feeds (team_id);
create index chat_feeds_conversation_idx on public.chat_feeds (conversation_id);

alter table public.chat_feeds enable row level security;
revoke all on public.chat_feeds from public, anon, authenticated;
grant select, delete on public.chat_feeds to authenticated;
grant update (name, enabled, events, conversation_id) on public.chat_feeds to authenticated;

create policy "Group admins read chat feeds" on public.chat_feeds for select to authenticated
  using (private.is_team_admin(team_id));
create policy "Group admins change chat feeds" on public.chat_feeds for update to authenticated
  using (private.is_team_admin(team_id)) with check (private.is_team_admin(team_id));
create policy "Group admins remove chat feeds" on public.chat_feeds for delete to authenticated
  using (private.is_team_admin(team_id));

-- A feed posts into a live channel of its own group.
create function private.check_chat_feed()
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
  new.name := btrim(new.name);
  return new;
end;
$$;
create trigger check_chat_feed before insert or update of conversation_id, name on public.chat_feeds
  for each row execute function private.check_chat_feed();

-- Webhook tokens, only as a SHA-256 hash; and each feed's posts this hour.
create table private.chat_feed_secrets (
  feed_id    uuid primary key references public.chat_feeds(id) on delete cascade,
  token_hash text not null
);
create table private.chat_feed_windows (
  feed_id      uuid primary key references public.chat_feeds(id) on delete cascade,
  window_start timestamptz not null,
  posted       integer not null default 0,
  held         integer not null default 0
);

alter publication supabase_realtime add table public.chat_feeds;

-- ---------------------------------------------------------------------------------------------------
-- Posting.

-- A title in bold, then the text one paragraph per line (the constrained chat schema).
create function private.chat_doc(p_title text, p_text text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('type', 'doc', 'content',
    coalesce(
      (select jsonb_agg(p order by n) from (
         select 0 as n, jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                  jsonb_build_object('type', 'text', 'text', p_title, 'marks', jsonb_build_array(jsonb_build_object('type', 'bold'))))) as p
          where nullif(btrim(coalesce(p_title, '')), '') is not null
         union all
         select l.n, case when btrim(l.line) = '' then jsonb_build_object('type', 'paragraph')
                          else jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', l.line))) end
           from unnest(string_to_array(coalesce(p_text, ''), E'\n')) with ordinality as l(line, n)
          where nullif(btrim(coalesce(p_text, '')), '') is not null
      ) parts),
      '[]'::jsonb));
$$;

create function private.chat_insert(p_feed public.chat_feeds, p_title text, p_text text, p_bot jsonb)
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
  v_id uuid;
begin
  if v_title = '' and v_text = '' then v_title := 'Alert'; end if;
  insert into public.messages (conversation_id, team_id, author_id, client_id, body, content, bot)
  values (p_feed.conversation_id, p_feed.team_id, null, gen_random_uuid(),
          private.chat_doc(v_title, v_text),
          left(concat_ws(E'\n', nullif(v_title, ''), nullif(v_text, '')), 20000),
          v_bot)
  returning id into v_id;

  if v_bot ->> 'level' = 'critical' then
    insert into public.notifications (team_id, recipient_id, conversation_id, message_id, kind, dedupe_key)
    select p_feed.team_id, tm.user_id, p_feed.conversation_id, v_id, 'alert', 'alert:' || v_id::text
      from public.team_members tm
     where tm.team_id = p_feed.team_id
       and not exists (select 1 from public.conversation_preferences cp
                        where cp.conversation_id = p_feed.conversation_id and cp.user_id = tm.user_id
                          and cp.notification_mode = 'muted')
    on conflict (recipient_id, dedupe_key) do nothing;
  end if;
  return v_id;
end;
$$;

-- Posts as the feed if it's on (and the group has the flag), within the hourly limit. Returns the
-- message, or null when nothing was posted.
create function private.chat_post(p_feed uuid, p_title text, p_text text, p_bot jsonb default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feed public.chat_feeds;
  v_limit integer;
  v_hour timestamptz := date_trunc('hour', now());
  v_win private.chat_feed_windows;
  v_id uuid;
begin
  select * into v_feed from public.chat_feeds f where f.id = p_feed and f.enabled;
  if v_feed.id is null
     or not exists (select 1 from public.teams t where t.id = v_feed.team_id)
     or not private.feature_enabled(v_feed.team_id, 'chat_feeds')
     or not exists (select 1 from public.conversations c where c.id = v_feed.conversation_id and not c.is_archived) then
    return null;
  end if;
  v_limit := case v_feed.kind when 'webhook' then 60 else 200 end;

  insert into private.chat_feed_windows (feed_id, window_start) values (v_feed.id, v_hour)
  on conflict (feed_id) do nothing;
  select * into v_win from private.chat_feed_windows w where w.feed_id = v_feed.id for update;

  if v_win.window_start < v_hour then
    if v_win.held > 0 then
      perform private.chat_insert(v_feed, null,
        v_win.held || case when v_win.held = 1 then ' message was' else ' messages were' end
          || ' held back in the last hour because this feed sent too many.', jsonb_build_object('level', 'warning'));
    end if;
    update private.chat_feed_windows set window_start = v_hour, posted = 0, held = 0 where feed_id = v_feed.id;
    v_win.posted := 0;
  end if;

  if v_win.posted >= v_limit then
    if v_win.posted = v_limit and v_win.held = 0 then
      perform private.chat_insert(v_feed, null,
        'Too many messages: the rest this hour are held back and counted.', jsonb_build_object('level', 'warning'));
    end if;
    update private.chat_feed_windows set held = held + 1 where feed_id = v_feed.id;
    return null;
  end if;

  v_id := private.chat_insert(v_feed, p_title, p_text, p_bot);
  update private.chat_feed_windows set posted = posted + 1 where feed_id = v_feed.id;
  update public.chat_feeds set last_posted_at = now() where id = v_feed.id;
  return v_id;
end;
$$;

-- An event for the group's events feed, if it's on and takes this kind of event.
create function private.chat_event(p_team uuid, p_event text, p_title text, p_text text, p_bot jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feed uuid;
begin
  select f.id into v_feed from public.chat_feeds f
   where f.team_id = p_team and f.kind = 'events' and f.enabled and p_event = any(f.events);
  if v_feed is not null then
    perform private.chat_post(v_feed, p_title, p_text, p_bot);
  end if;
end;
$$;

-- Whoever made the change ("Someone" from the server or a deleted profile).
create function private.chat_actor()
returns text
language sql
stable security definer
set search_path = ''
as $$
  select coalesce((select p.display_name from public.profiles p where p.id = (select auth.uid())), 'Someone');
$$;

-- ---------------------------------------------------------------------------------------------------
-- Calsko events. Each trigger leaves at once unless the group has an events feed that's on.

create function private.has_events_feed(p_team uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_feeds f where f.team_id = p_team and f.kind = 'events' and f.enabled);
$$;

create function private.chat_issue_event()
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
  if v_ws.id is null or v_ws.access <> 'group' then return null; end if;
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
create trigger chat_issue_created after insert on public.issues
  for each row execute function private.chat_issue_event();
create trigger chat_issue_closed after update of status on public.issues
  for each row execute function private.chat_issue_event();

-- Meetings: one message per meeting or per repeating series, whatever the statement inserted or deleted.
-- `p_rows` are the statement's rows (its transition table as JSON).
create function private.chat_meetings(p_op text, p_rows jsonb)
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
    -- A project's meeting only when the whole group can see the project.
    continue when r.workspace_id is not null and not exists (
      select 1 from public.workspaces w where w.id = r.workspace_id and w.access = 'group');
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

create function private.chat_meetings_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.chat_meetings('INSERT', (select jsonb_agg(to_jsonb(n)) from new_rows n));
  return null;
end;
$$;
create function private.chat_meetings_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.chat_meetings('DELETE', (select jsonb_agg(to_jsonb(o)) from old_rows o));
  return null;
end;
$$;
create trigger chat_meeting_scheduled after insert on public.live_sessions
  referencing new table as new_rows for each statement execute function private.chat_meetings_added();
create trigger chat_meeting_cancelled after delete on public.live_sessions
  referencing old table as old_rows for each statement execute function private.chat_meetings_removed();

create function private.chat_plan_event()
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
  perform private.chat_event(new.team_id, 'plan_created', private.chat_actor() || ' created a plan', new.name,
    jsonb_build_object('name', 'Calsko', 'icon', 'plan', 'link', '/t/' || v_slug || '/issues/plans/' || new.id));
  return null;
end;
$$;
create trigger chat_plan_created after insert on public.plans
  for each row execute function private.chat_plan_event();

create function private.chat_member_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_events_feed(new.team_id) then return null; end if;
  perform private.chat_event(new.team_id, 'member_joined',
    coalesce((select p.display_name from public.profiles p where p.id = new.user_id), 'Someone') || ' joined the group', null,
    jsonb_build_object('name', 'Calsko', 'icon', 'member', 'level', 'success'));
  return null;
end;
$$;
create trigger chat_member_joined after insert on public.team_members
  for each row execute function private.chat_member_event();

-- ---------------------------------------------------------------------------------------------------
-- Managing feeds (group owners and admins, with the flag on).

create function private.require_chat_feed_admin(p_team uuid)
returns void
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  if not private.is_team_admin(p_team) then
    raise exception 'Only group owners and admins manage chat feeds' using errcode = '42501';
  end if;
  if not private.feature_enabled(p_team, 'chat_feeds') then
    raise exception 'Chat feeds aren''t switched on for this group' using errcode = '42501';
  end if;
end;
$$;

-- The #activity channel (made when missing): where feeds post unless told otherwise.
create function private.activity_channel(p_team uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id from public.conversations c
   where c.team_id = p_team and c.kind = 'channel' and lower(c.name) = 'activity';
  if v_id is null then
    insert into public.conversations (team_id, kind, name, description, created_by)
    values (p_team, 'channel', 'activity', 'What happens in the group, posted by Calsko and connected tools.', (select auth.uid()))
    returning id into v_id;
  else
    update public.conversations set is_archived = false where id = v_id and is_archived;
  end if;
  return v_id;
end;
$$;

-- Switches on the group's events or errors feed, in the given channel or #activity. Returns its id.
create function public.enable_chat_feed(p_team uuid, p_kind text, p_conversation uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel uuid;
  v_id uuid;
begin
  perform private.require_chat_feed_admin(p_team);
  if p_kind not in ('events', 'errors') then raise exception 'Unknown feed' using errcode = '22023'; end if;
  v_channel := coalesce(p_conversation, private.activity_channel(p_team));
  insert into public.chat_feeds (team_id, conversation_id, kind, name, events)
  values (p_team, v_channel, p_kind,
          case p_kind when 'events' then 'Calsko' else 'Error tracking' end,
          case p_kind when 'events' then array['issue_created', 'issue_closed', 'meeting_scheduled', 'meeting_cancelled', 'plan_created', 'member_joined'] else '{}' end)
  on conflict (team_id, kind) where kind in ('events', 'errors')
  do update set enabled = true, conversation_id = case when p_conversation is null then public.chat_feeds.conversation_id else excluded.conversation_id end
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.enable_chat_feed(uuid, text, uuid) from public, anon;
grant execute on function public.enable_chat_feed(uuid, text, uuid) to authenticated;

-- A new webhook. Returns { id, token }; the token is shown once.
create function public.create_chat_webhook(p_team uuid, p_name text, p_conversation uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_token text := private.random_token();
begin
  perform private.require_chat_feed_admin(p_team);
  if (select count(*) from public.chat_feeds f where f.team_id = p_team and f.kind = 'webhook') >= 20 then
    raise exception 'A group can have at most 20 webhooks' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Give the webhook a name' using errcode = '22023';
  end if;
  insert into public.chat_feeds (team_id, conversation_id, kind, name)
  values (p_team, coalesce(p_conversation, private.activity_channel(p_team)), 'webhook', p_name)
  returning id into v_id;
  insert into private.chat_feed_secrets (feed_id, token_hash) values (v_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;
revoke all on function public.create_chat_webhook(uuid, text, uuid) from public, anon;
grant execute on function public.create_chat_webhook(uuid, text, uuid) to authenticated;

-- A new token for a webhook (the old one stops working). Returns it, once.
create function public.rotate_chat_webhook_token(p_feed uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feed public.chat_feeds;
  v_token text := private.random_token();
begin
  select * into v_feed from public.chat_feeds f where f.id = p_feed;
  if v_feed.id is null or v_feed.kind <> 'webhook' then raise exception 'Webhook not found' using errcode = '42501'; end if;
  perform private.require_chat_feed_admin(v_feed.team_id);
  insert into private.chat_feed_secrets (feed_id, token_hash) values (p_feed, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (feed_id) do update set token_hash = excluded.token_hash;
  return v_token;
end;
$$;
revoke all on function public.rotate_chat_webhook_token(uuid) from public, anon;
grant execute on function public.rotate_chat_webhook_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- For the Edge Functions (service role only).

-- The webhook this token belongs to, if it's on and the group has the flag.
create function public.chat_webhook_for_token(p_feed uuid, p_token text)
returns table (id uuid, name text)
language sql
stable security definer
set search_path = ''
as $$
  select f.id, f.name
    from public.chat_feeds f
    join private.chat_feed_secrets x on x.feed_id = f.id
   where f.id = p_feed and f.kind = 'webhook' and f.enabled
     and x.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and private.feature_enabled(f.team_id, 'chat_feeds');
$$;
revoke all on function public.chat_webhook_for_token(uuid, text) from public, anon, authenticated;
grant execute on function public.chat_webhook_for_token(uuid, text) to service_role;

-- A message from outside (chat-intake has parsed AWS, Azure, Slack-style or Calsko's own format).
create function public.chat_webhook_post(p_feed uuid, p_title text, p_text text, p_level text, p_url text, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.chat_post(p_feed, p_title, p_text, jsonb_build_object(
    'level', case when p_level in ('info', 'success', 'warning', 'critical') then p_level else 'info' end,
    'url', case when p_url ~* '^https?://' then left(p_url, 2000) end,
    'source', left(p_source, 40)));
end;
$$;
revoke all on function public.chat_webhook_post(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.chat_webhook_post(uuid, text, text, text, text, text) to service_role;

-- Error tracking's summary for one source after a run (error-sync). Nothing when nothing happened, or when
-- the project isn't open to the whole group (its issue titles would reach people who can't see them).
create function public.chat_post_error_summary(p_source uuid, p_ok boolean, p_errors integer, p_issues integer, p_since timestamptz, p_message text)
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
  if v_feed is null then return; end if;
  select * into v_ws from public.workspaces w where w.id = v_source.workspace_id;
  if v_ws.access <> 'group' then return; end if;
  if p_ok and coalesce(p_errors, 0) = 0 and coalesce(p_issues, 0) = 0 then return; end if;
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
revoke all on function public.chat_post_error_summary(uuid, boolean, integer, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.chat_post_error_summary(uuid, boolean, integer, integer, timestamptz, text) to service_role;

-- The private helpers are only for these functions and the triggers.
revoke all on function private.chat_doc(text, text) from public, anon, authenticated;
revoke all on function private.chat_insert(public.chat_feeds, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.chat_post(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.chat_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.activity_channel(uuid) from public, anon, authenticated;
revoke all on function private.chat_meetings(text, jsonb) from public, anon, authenticated;
