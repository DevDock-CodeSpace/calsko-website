-- Canceled sub-issues count as finished in the parent status rollup, as they already do in the
-- sub-issue progress bar. Before, one canceled sub-issue kept its parent from ever reaching Done,
-- and GitHub closing the parent was turned back into Todo.
--
-- Nothing left open: the parent is Done when at least one sub-issue is Done (all canceled leaves it
-- as it is). GitHub may close a parent once nothing under it is open.

create or replace function private.issue_children_complete(p_parent_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with recursive descendants as (
    select i.id, i.parent_id, i.status
    from public.issues i
    where i.parent_id = p_parent_id
    union all
    select child.id, child.parent_id, child.status
    from public.issues child
    join descendants parent on child.parent_id = parent.id
  )
  select count(*) > 0
     and coalesce(bool_and(d.status in ('done', 'canceled')), false)
  from descendants d;
$$;

create or replace function private.refresh_issue_parent_status(p_parent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status public.issue_status;
  child_count integer;
  any_child_open boolean;
  any_child_done boolean;
  any_child_active boolean;
  next_status public.issue_status;
  original_via text := current_setting('devdock.via', true);
begin
  if p_parent_id is null then return; end if;

  select i.status into parent_status
  from public.issues i
  where i.id = p_parent_id
  for update;
  if not found then return; end if;

  with recursive descendants as (
    select i.id, i.parent_id, i.status
    from public.issues i
    where i.parent_id = p_parent_id
    union all
    select child.id, child.parent_id, child.status
    from public.issues child
    join descendants parent on child.parent_id = parent.id
  )
  select count(*)::integer,
         coalesce(bool_or(d.status not in ('done', 'canceled')), false),
         coalesce(bool_or(d.status = 'done'), false),
         coalesce(bool_or(d.status in ('in_progress', 'in_review')), false)
  into child_count, any_child_open, any_child_done, any_child_active
  from descendants d;

  -- Deleting the final child does not change the parent's manually chosen status.
  if child_count = 0 then return; end if;

  if not any_child_open then
    if not any_child_done then return; end if;
    next_status := 'done';
  elsif any_child_active then
    next_status := 'in_progress';
  elsif parent_status = 'done' then
    next_status := 'todo';
  else
    return;
  end if;

  if next_status = parent_status then return; end if;

  if coalesce(current_setting('devdock.via', true), '') <> 'github' then
    perform set_config('devdock.via', 'rollup', true);
  end if;
  update public.issues set status = next_status where id = p_parent_id;
  if coalesce(current_setting('devdock.via', true), '') = 'rollup' then
    perform set_config('devdock.via', coalesce(original_via, ''), true);
  end if;
end;
$$;
