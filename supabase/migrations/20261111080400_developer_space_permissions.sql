-- Workspace Developers are limited to Spaces inside Development collections.

create function private.is_development_space(w uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces workspace
    join public.workspace_collections collection
      on collection.id = workspace.collection_id
     and collection.team_id = workspace.team_id
    where workspace.id = w
      and workspace.type = 'general'
      and collection.type = 'development'
  );
$$;

revoke all on function private.is_development_space(uuid) from public, anon, authenticated;
grant execute on function private.is_development_space(uuid) to authenticated;

create function private.enforce_developer_workspace_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'developer' and not private.is_development_space(new.workspace_id) then
    raise exception 'Developer role is only available in Spaces in Development collections'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_developer_workspace_role() from public, anon, authenticated;

create trigger enforce_developer_workspace_role
  before insert or update of role, workspace_id on public.workspace_members
  for each row execute function private.enforce_developer_workspace_role();

create function private.prevent_developer_workspace_scope_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = old.id
      and member.role = 'developer'
  ) and (
    new.type <> 'general'
    or not exists (
      select 1
      from public.workspace_collections collection
      where collection.id = new.collection_id
        and collection.team_id = new.team_id
        and collection.type = 'development'
    )
  ) then
    raise exception 'Remove Developer members before moving this Space outside Development collections'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_developer_workspace_scope_change() from public, anon, authenticated;

create trigger prevent_developer_workspace_scope_change
  before update of type, collection_id on public.workspaces
  for each row execute function private.prevent_developer_workspace_scope_change();

create function private.prevent_developer_collection_type_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> 'development' and exists (
    select 1
    from public.workspaces workspace
    join public.workspace_members member on member.workspace_id = workspace.id
    where workspace.collection_id = old.id
      and member.role = 'developer'
  ) then
    raise exception 'Remove Developer members before changing this Development collection type'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_developer_collection_type_change() from public, anon, authenticated;

create trigger prevent_developer_collection_type_change
  before update of type on public.workspace_collections
  for each row execute function private.prevent_developer_collection_type_change();

drop policy "Members can leave; admins and leads can remove members" on public.workspace_members;
create policy "Members can leave; admins and leads can remove members and developers"
  on public.workspace_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_team_admin(team_id)
    or (private.workspace_role(workspace_id) = 'lead' and role in ('member', 'developer'))
  );

create or replace function private.can_create_live_session(t uuid, w uuid)
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
        (w is null and exists (
          select 1 from public.teams team where team.id = t and team.type = 'development'
        ))
        or exists (
          select 1
          from public.teams team
          join public.workspaces workspace on workspace.team_id = team.id
          join public.workspace_modules wm on wm.workspace_id = workspace.id
          left join public.workspace_collections collection on collection.id = workspace.collection_id
          where team.id = t
            and workspace.id = w
            and workspace.type = 'project'
            and wm.module = 'live'
            and private.can_view_workspace(workspace.id)
            and (team.type = 'development' or collection.type = 'development')
        )
      )
    )
    or (
      private.workspace_role(w) = 'developer'
      and private.is_development_space(w)
      and exists (
        select 1
        from public.workspaces workspace
        join public.workspace_modules wm on wm.workspace_id = workspace.id
        where workspace.id = w
          and workspace.team_id = t
          and wm.module = 'live'
          and private.can_view_workspace(workspace.id)
      )
    );
$$;

drop policy "Writers can edit live sessions" on public.live_sessions;
create policy "Writers can edit live sessions"
  on public.live_sessions for update to authenticated
  using (
    private.can_write_document(team_id, workspace_id)
    or (
      created_by = (select auth.uid())
      and private.can_create_live_session(team_id, workspace_id)
      and (
        private.team_role(team_id) = 'developer'
        or private.workspace_role(workspace_id) = 'developer'
      )
    )
  )
  with check (
    private.can_write_document(team_id, workspace_id)
    or (
      created_by = (select auth.uid())
      and private.can_create_live_session(team_id, workspace_id)
      and (
        private.team_role(team_id) = 'developer'
        or private.workspace_role(workspace_id) = 'developer'
      )
    )
  );

create or replace function private.protect_developer_meeting_calendar_update()
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
    and private.can_create_live_session(old.team_id, old.workspace_id)
    and (
      private.team_role(old.team_id) = 'developer'
      or private.workspace_role(old.workspace_id) = 'developer'
    )
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
  if not found or not (
    private.can_write_document(v_session.team_id, v_session.workspace_id)
    or (
      v_session.created_by = (select auth.uid())
      and private.can_create_live_session(v_session.team_id, v_session.workspace_id)
      and (
        private.team_role(v_session.team_id) = 'developer'
        or private.workspace_role(v_session.workspace_id) = 'developer'
      )
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
        or (v_session.workspace_id is not null and private.has_workspace_access(v_session.workspace_id, users.id))
      );
end;
$$;
