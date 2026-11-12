-- A Developer role is also available in a General group that has a Development collection.
-- The role remains group-wide; its additional meeting permission is limited to Development projects.

create or replace function private.is_development_team(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teams team
    where team.id = t
      and (
        team.type = 'development'
        or exists (
          select 1
          from public.workspace_collections collection
          where collection.team_id = team.id
            and collection.type = 'development'
        )
      )
  );
$$;

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
            and (
              team.type = 'development'
              or collection.type = 'development'
            )
        )
      )
    );
$$;
