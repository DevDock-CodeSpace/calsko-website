-- Calls started from a DM or group chat are private to that conversation.
alter table public.live_sessions
  add column conversation_id uuid,
  add constraint live_sessions_conversation_team_fkey
    foreign key (conversation_id, team_id)
    references public.conversations (id, team_id) on delete cascade,
  add constraint live_sessions_conversation_workspace
    check (conversation_id is null or workspace_id is null);

create index live_sessions_conversation_idx
  on public.live_sessions (conversation_id, starts_at)
  where conversation_id is not null;

comment on column public.live_sessions.conversation_id is
  'When set, the call is visible only to active members of this DM or group chat.';

create function private.check_live_session_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.conversation_id is not null and not exists (
    select 1
    from public.conversations c
    where c.id = new.conversation_id
      and c.team_id = new.team_id
      and c.kind in ('dm', 'group')
      and not c.is_archived
  ) then
    raise exception 'Calls can only be started in an active DM or group chat' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.check_live_session_conversation() from public, anon, authenticated;

create trigger check_live_session_conversation
  before insert or update of conversation_id, team_id, workspace_id on public.live_sessions
  for each row execute function private.check_live_session_conversation();

create function private.can_read_live_session(p_team_id uuid, p_workspace_id uuid, p_conversation_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_conversation_id is null then private.can_read_document(p_team_id, p_workspace_id)
    else private.can_read_conversation(p_conversation_id)
  end;
$$;
revoke all on function private.can_read_live_session(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_read_live_session(uuid, uuid, uuid) to authenticated;

drop policy "Readers can see live sessions" on public.live_sessions;
create policy "Readers can see live sessions"
  on public.live_sessions for select to authenticated
  using (private.can_read_live_session(team_id, workspace_id, conversation_id));

drop policy "Writers can schedule live sessions" on public.live_sessions;
create policy "Writers can schedule live sessions"
  on public.live_sessions for insert to authenticated
  with check (conversation_id is null and private.can_create_live_session(team_id, workspace_id));

create policy "Conversation members can start calls"
  on public.live_sessions for insert to authenticated
  with check (
    conversation_id is not null
    and workspace_id is null
    and private.can_read_conversation(conversation_id)
  );

drop policy "Writers can edit live sessions" on public.live_sessions;
create policy "Writers can edit live sessions"
  on public.live_sessions for update to authenticated
  using (
    conversation_id is null
    and (
      private.can_write_document(team_id, workspace_id)
      or (
        created_by = (select auth.uid())
        and private.workspace_role(workspace_id) = 'developer'
        and private.can_create_live_session(team_id, workspace_id)
      )
    )
  )
  with check (
    conversation_id is null
    and (
      private.can_write_document(team_id, workspace_id)
      or (
        created_by = (select auth.uid())
        and private.workspace_role(workspace_id) = 'developer'
        and private.can_create_live_session(team_id, workspace_id)
      )
    )
  );

drop policy "Writers can cancel live sessions" on public.live_sessions;
create policy "Writers can cancel live sessions"
  on public.live_sessions for delete to authenticated
  using (conversation_id is null and private.can_write_document(team_id, workspace_id));

grant insert (conversation_id) on public.live_sessions to authenticated;

-- A safe realtime marker lets chat participants refresh meeting lists without publishing room_name.
create table public.live_session_events (
  session_id uuid primary key references public.live_sessions (id) on delete cascade
);
comment on table public.live_session_events is
  'Private-call change markers. Contains no room details; visible only to people who can read the session.';
revoke all on table public.live_session_events from anon, authenticated;
grant select on public.live_session_events to authenticated;
alter table public.live_session_events enable row level security;
create policy "Readers can see private call events"
  on public.live_session_events for select to authenticated
  using (exists (select 1 from public.live_sessions s where s.id = session_id));

create function private.signal_private_live_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.conversation_id is not null then
    insert into public.live_session_events (session_id) values (new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.signal_private_live_session() from public, anon, authenticated;
create trigger signal_private_live_session
  after insert on public.live_sessions
  for each row execute function private.signal_private_live_session();

alter publication supabase_realtime add table public.live_session_events;

-- Calls have no calendar invite audience; don't let a group admin turn one into a group-wide invite.
create or replace function public.live_session_invitees(p_session_id uuid)
returns table (email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.live_sessions;
begin
  select * into v_session from public.live_sessions where id = p_session_id;
  if not found or v_session.conversation_id is not null or not (
    private.can_write_document(v_session.team_id, v_session.workspace_id)
    or (
      v_session.created_by = (select auth.uid())
      and private.workspace_role(v_session.workspace_id) = 'developer'
      and private.can_create_live_session(v_session.team_id, v_session.workspace_id)
    )
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
    select distinct users.email::text
    from auth.users users
    where users.id <> (select auth.uid())
      and users.email is not null
      and (
        (v_session.workspace_id is null and exists (
          select 1 from public.team_members member
          where member.team_id = v_session.team_id and member.user_id = users.id
        ))
        or (
          v_session.workspace_id is not null
          and private.has_workspace_access(v_session.workspace_id, users.id)
        )
      );
end;
$$;

-- RSVPs are only for calendar invites, not private calls.
drop policy "Readers can see meeting replies" on public.live_session_rsvps;
create policy "Readers can see meeting replies"
  on public.live_session_rsvps for select to authenticated
  using (
    exists (
      select 1
      from public.live_sessions s
      where s.id = session_id
        and private.can_read_live_session(s.team_id, s.workspace_id, s.conversation_id)
    )
  );

create function private.reject_private_call_rsvp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.live_sessions s
    where s.id = new.session_id and s.conversation_id is not null
  ) then
    raise exception 'Private calls do not have calendar replies' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_private_call_rsvp() from public, anon, authenticated;
create trigger reject_private_call_rsvp
  before insert or update on public.live_session_rsvps
  for each row execute function private.reject_private_call_rsvp();

-- Private calls never go to the whole-group email queue.
drop trigger queue_meeting_email on public.live_sessions;
create trigger queue_meeting_email_insert
  after insert on public.live_sessions
  for each row when (new.conversation_id is null)
  execute function private.queue_meeting_email();
create trigger queue_meeting_email_update
  after update on public.live_sessions
  for each row when (old.conversation_id is null and new.conversation_id is null)
  execute function private.queue_meeting_email();
create trigger queue_meeting_email_delete
  after delete on public.live_sessions
  for each row when (old.conversation_id is null)
  execute function private.queue_meeting_email();

-- Keep the existing batch handling for repeating series, while filtering out private calls.
create or replace function private.chat_meetings_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from new_rows n where n.conversation_id is null) then
    perform private.chat_meetings(
      'INSERT',
      (select jsonb_agg(to_jsonb(n)) from new_rows n where n.conversation_id is null)
    );
  end if;
  return null;
end;
$$;

create or replace function private.chat_meetings_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from old_rows o where o.conversation_id is null) then
    perform private.chat_meetings(
      'DELETE',
      (select jsonb_agg(to_jsonb(o)) from old_rows o where o.conversation_id is null)
    );
  end if;
  return null;
end;
$$;

-- A private call must not reveal that the session id belongs to a hidden row.
create or replace function public.can_moderate_live_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_read_live_session(s.team_id, s.workspace_id, s.conversation_id)
       and private.can_write_document(s.team_id, s.workspace_id)
    from public.live_sessions s
    where s.id = p_session_id
  ), false);
$$;