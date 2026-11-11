-- A plan with work in progress should not remain "Not started".
create function private.start_plan_from_active_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_id is not null and new.status in ('in_progress', 'in_review') then
    update public.plans
    set status = 'in_progress'
    where id = new.plan_id and status = 'not_started';
  end if;

  return new;
end;
$$;

create trigger start_plan_from_active_issue
  after insert or update of plan_id, status on public.issues
  for each row execute function private.start_plan_from_active_issue();

revoke all on function private.start_plan_from_active_issue() from public, anon, authenticated;

-- Correct existing plans too; the trigger handles future issue changes.
update public.plans p
set status = 'in_progress'
where p.status = 'not_started'
  and exists (
    select 1
    from public.issues i
    where i.plan_id = p.id
      and i.status in ('in_progress', 'in_review')
  );
