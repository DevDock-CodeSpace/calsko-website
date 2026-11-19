-- Assigned plan leads may delete individual files in their plan folders.
-- Team owners/admins retain the existing delete access through the Writers policies.

create function private.is_plan_file_lead(p_team_id uuid, p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = private.plan_of_folder(p_folder_id)
      and p.team_id = p_team_id
      and p.lead_id = (select auth.uid())
      and private.is_team_member(p_team_id)
  );
$$;

revoke all on function private.is_plan_file_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_plan_file_lead(uuid, uuid) to authenticated;

create policy "Plan leads delete plan docs"
  on public.documents for delete to authenticated
  using (
    workspace_id is null
    and folder_id is not null
    and private.is_plan_file_lead(team_id, folder_id)
  );

create policy "Plan leads delete plan whiteboards"
  on public.diagrams for delete to authenticated
  using (
    workspace_id is null
    and folder_id is not null
    and private.is_plan_file_lead(team_id, folder_id)
  );
