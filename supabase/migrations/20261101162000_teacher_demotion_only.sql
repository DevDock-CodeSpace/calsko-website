-- Only someone who stops being a *teacher* stops leading courses. An admin made a member keeps the courses
-- they lead: in a company group (a senior engineer leading onboarding), leads are often ordinary members
-- whom an admin made lead, and losing that silently would be wrong.
create or replace function private.drop_former_teacher_leads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'teacher' and new.role = 'member' then
    update public.workspace_members wm
    set role = 'member'
    from public.workspaces w
    where wm.workspace_id = w.id and w.team_id = new.team_id and w.type = 'course'
      and wm.user_id = new.user_id and wm.role = 'lead';
  end if;
  return null;
end;
$$;
