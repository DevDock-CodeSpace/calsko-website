-- Developers are a limited group role: normal member access, plus creating meetings
-- in development groups and projects they can access.

create function private.is_development_team(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = $1 and t.type = 'development'
  );
$$;

revoke all on function private.is_development_team(uuid) from public, anon, authenticated;
grant execute on function private.is_development_team(uuid) to authenticated;

create function private.enforce_developer_team_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'developer' and not private.is_development_team(new.team_id) then
    raise exception 'Developer role is only available in development groups' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_developer_team_role() from public, anon, authenticated;

create trigger enforce_developer_team_role
  before insert or update on public.team_members
  for each row execute function private.enforce_developer_team_role();

create function private.prevent_group_type_change_with_developers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> 'development' and exists (
    select 1
    from public.team_members m
    where m.team_id = new.id and m.role = 'developer'
  ) then
    raise exception 'Remove Developer members before changing this development group type' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_group_type_change_with_developers() from public, anon, authenticated;

create trigger prevent_group_type_change_with_developers
  before update of type on public.teams
  for each row execute function private.prevent_group_type_change_with_developers();

drop policy "Owners and admins can add team members" on public.team_members;
create policy "Owners and admins can add team members"
  on public.team_members for insert to authenticated
  with check (
    role <> 'owner'
    and (
      private.team_role(team_id) = 'owner'
      or (
        private.team_role(team_id) = 'admin'
        and (
          role in ('member', 'teacher')
          or (role = 'developer' and private.is_development_team(team_id))
        )
      )
    )
  );

drop policy "Owners change roles; admins switch members and teachers" on public.team_members;
create policy "Owners change roles; admins switch members, teachers, and developers"
  on public.team_members for update to authenticated
  using (
    user_id <> (select auth.uid())
    and (
      private.team_role(team_id) = 'owner'
      or (
        private.team_role(team_id) = 'admin'
        and (
          role in ('member', 'teacher')
          or (role = 'developer' and private.is_development_team(team_id))
        )
      )
    )
  )
  with check (
    role <> 'owner'
    and (
      private.team_role(team_id) = 'owner'
      or role in ('member', 'teacher')
      or (role = 'developer' and private.is_development_team(team_id))
    )
  );

drop policy "Members can leave; owners and admins can remove members" on public.team_members;
create policy "Members can leave; owners and admins can remove members"
  on public.team_members for delete to authenticated
  using (
    role <> 'owner'
    and (
      user_id = (select auth.uid())
      or private.team_role(team_id) = 'owner'
      or (
        private.team_role(team_id) = 'admin'
        and (
          role in ('member', 'teacher')
          or (role = 'developer' and private.is_development_team(team_id))
        )
      )
    )
  );

create function private.can_create_live_session(t uuid, w uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_write_document(t, w)
    or (
      private.team_role(t) = 'developer'
      and private.is_development_team(t)
      and (
        w is null
        or exists (
          select 1
          from public.workspaces ws
          join public.workspace_modules wm on wm.workspace_id = ws.id
          where ws.id = w
            and ws.team_id = t
            and ws.type = 'project'
            and wm.module = 'live'
            and private.can_view_workspace(ws.id)
        )
      )
    );
$$;

revoke all on function private.can_create_live_session(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_create_live_session(uuid, uuid) to authenticated;

drop policy "Writers can schedule live sessions" on public.live_sessions;
create policy "Writers can schedule live sessions"
  on public.live_sessions for insert to authenticated
  with check (private.can_create_live_session(team_id, workspace_id));

drop policy "Writers can edit live sessions" on public.live_sessions;
create policy "Writers can edit live sessions"
  on public.live_sessions for update to authenticated
  using (
    private.can_write_document(team_id, workspace_id)
    or (
      created_by = (select auth.uid())
      and private.team_role(team_id) = 'developer'
      and private.can_create_live_session(team_id, workspace_id)
    )
  )
  with check (
    private.can_write_document(team_id, workspace_id)
    or (
      created_by = (select auth.uid())
      and private.team_role(team_id) = 'developer'
      and private.can_create_live_session(team_id, workspace_id)
    )
  );

create function private.protect_developer_meeting_calendar_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.can_write_document(old.team_id, old.workspace_id) then
    return new;
  end if;

  if old.created_by = (select auth.uid())
    and private.team_role(old.team_id) = 'developer'
    and private.can_create_live_session(old.team_id, old.workspace_id)
    and old.calendar_event_id is null
    and new.calendar_event_id is not null
    and new.calendar_event_id <> ''
    and new.team_id is not distinct from old.team_id
    and new.workspace_id is not distinct from old.workspace_id
    and new.title is not distinct from old.title
    and new.description is not distinct from old.description
    and new.starts_at is not distinct from old.starts_at
    and new.ends_at is not distinct from old.ends_at
    and new.room_name is not distinct from old.room_name
    and new.series_id is not distinct from old.series_id
    and new.created_by is not distinct from old.created_by
    and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'Developers can only save a calendar event for meetings they created' using errcode = '42501';
end;
$$;

revoke all on function private.protect_developer_meeting_calendar_update() from public, anon, authenticated;

create trigger protect_developer_meeting_calendar_update
  before update on public.live_sessions
  for each row execute function private.protect_developer_meeting_calendar_update();

create or replace function public.live_session_invitees(p_session_id uuid)
returns table (email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.live_sessions;
begin
  select * into s from public.live_sessions where id = p_session_id;
  if not found or not (
    private.can_write_document(s.team_id, s.workspace_id)
    or (
      s.created_by = (select auth.uid())
      and private.team_role(s.team_id) = 'developer'
      and private.can_create_live_session(s.team_id, s.workspace_id)
    )
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select distinct u.email::text
    from auth.users u
    where u.id <> (select auth.uid())
      and u.email is not null
      and (
        (s.workspace_id is null and exists (
          select 1 from public.team_members m where m.team_id = s.team_id and m.user_id = u.id))
        or (s.workspace_id is not null and private.has_workspace_access(s.workspace_id, u.id))
      );
end;
$$;

create or replace function public.create_live_series(
  p_team_id uuid,
  p_workspace_id uuid,
  p_title text,
  p_description text,
  p_starts timestamptz[],
  p_duration_minutes integer
)
returns table (id uuid, series_id uuid, starts_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null or not private.can_create_live_session(p_team_id, p_workspace_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_starts is null or cardinality(p_starts) not between 1 and 60 then
    raise exception 'A series has 1 to 60 meetings' using errcode = '23514';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 5 and 720 then
    raise exception 'Meetings last 5 minutes to 12 hours' using errcode = '23514';
  end if;

  return query
    insert into public.live_sessions as s (team_id, workspace_id, title, description, starts_at, ends_at, series_id, created_by)
    select p_team_id, p_workspace_id, p_title, nullif(btrim(p_description), ''), t,
           t + make_interval(mins => p_duration_minutes),
           case when cardinality(p_starts) > 1 then v_series end,
           (select auth.uid())
    from unnest(p_starts) as t
    returning s.id, s.series_id, s.starts_at;
end;
$$;
