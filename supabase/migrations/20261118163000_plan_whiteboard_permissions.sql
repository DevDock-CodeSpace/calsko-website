-- A Plan's linked Whiteboard is editable by its lead, creator, team admins/owners,
-- and Developers in workspaces that have issues assigned to the Plan.
-- Other files in a Plan folder keep the existing team-wide editing rules.

create function private.is_plan_whiteboard(p_diagram uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.plans p where p.whiteboard_id = p_diagram);
$$;

create function private.can_edit_plan_whiteboard(p_diagram uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.plans p
     where p.whiteboard_id = p_diagram
       and (
         p.lead_id = (select auth.uid())
         or p.created_by = (select auth.uid())
         or private.is_team_admin(p.team_id)
         or exists (
           select 1
             from public.issues i
            where i.plan_id = p.id
              and private.workspace_role(i.workspace_id) = 'developer'
         )
       )
  );
$$;

revoke all on function private.is_plan_whiteboard(uuid) from public, anon, authenticated;
revoke all on function private.can_edit_plan_whiteboard(uuid) from public, anon, authenticated;
grant execute on function private.is_plan_whiteboard(uuid) to authenticated;
grant execute on function private.can_edit_plan_whiteboard(uuid) to authenticated;

-- Keep the existing access-level contract in sync with what an ordinary team
-- member can do on a Plan's linked Whiteboard.
create or replace function public.access_level(d public.diagrams)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.file_level(d.team_id, d.workspace_id, d.folder_id, d.access, d.created_by, 'diagram', d.id) = 3
      and private.is_plan_whiteboard(d.id)
      and not private.can_edit_plan_whiteboard(d.id)
      then 1::smallint
    else private.file_level(d.team_id, d.workspace_id, d.folder_id, d.access, d.created_by, 'diagram', d.id)
  end;
$$;

create function public.plan_whiteboard_editable(d public.diagrams)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit_plan_whiteboard(d.id);
$$;

revoke execute on function public.plan_whiteboard_editable(public.diagrams) from public, anon;
grant execute on function public.plan_whiteboard_editable(public.diagrams) to authenticated;

drop policy "Writers can edit diagrams" on public.diagrams;
create policy "Writers can edit diagrams" on public.diagrams for update to authenticated
  using (
    private.file_level(team_id, workspace_id, folder_id, access, created_by, 'diagram', id) = 2
    or (
      private.file_level(team_id, workspace_id, folder_id, access, created_by, 'diagram', id) = 3
      and private.can_write_document(team_id, workspace_id)
    )
    or (
      private.file_level(team_id, workspace_id, folder_id, access, created_by, 'diagram', id) = 3
      and workspace_id is null
      and folder_id is not null
      and private.plan_of_folder(folder_id) is not null
      and not private.is_plan_whiteboard(id)
    )
    or (
      private.file_level(team_id, workspace_id, folder_id, access, created_by, 'diagram', id) >= 1
      and private.can_edit_plan_whiteboard(id)
    )
  )
  with check (private.can_read_document(team_id, workspace_id));
