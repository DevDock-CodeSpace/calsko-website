-- Mirror Calsko issue hierarchy to GitHub and roll parent statuses up from children.

create table public.issue_github_links (
  issue_id            uuid primary key,
  workspace_id        uuid not null,
  repo_id             uuid not null references public.repos (id) on delete cascade,
  github_issue_id     bigint not null,
  github_issue_number integer not null,
  url                 text not null,
  created_at          timestamptz not null default now(),

  constraint issue_github_links_issue_fkey foreign key (issue_id, workspace_id)
    references public.issues (id, workspace_id) on delete cascade,
  constraint issue_github_links_github_id_unique unique (repo_id, github_issue_id),
  constraint issue_github_links_github_number_unique unique (repo_id, github_issue_number),
  constraint issue_github_links_github_id_positive check (github_issue_id > 0),
  constraint issue_github_links_github_number_positive check (github_issue_number > 0)
);

comment on table public.issue_github_links is
  'GitHub issues created for Calsko issues. Written only by the github Edge Function.';

revoke all on table public.issue_github_links from public, anon, authenticated;
grant all on table public.issue_github_links to service_role;
alter table public.issue_github_links enable row level security;

-- Internal sync state has no client query to invalidate, but stays in the
-- publication so any future authenticated reader can receive its own changes.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'issue_github_links'
  ) then
    alter publication supabase_realtime add table public.issue_github_links;
  end if;
end;
$$;

create function private.issue_children_complete(p_parent_id uuid)
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
     and coalesce(bool_and(d.status = 'done'), false)
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
  all_children_done boolean;
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
         coalesce(bool_or(d.status in ('in_progress', 'in_review')), false)
  into child_count, any_child_active
  from descendants d;

  -- Deleting the final child does not change the parent's manually chosen status.
  if child_count = 0 then return; end if;

  all_children_done := private.issue_children_complete(p_parent_id);

  if all_children_done then
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

create function private.guard_parent_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  child_active boolean;
begin
  if new.status <> 'done'
     or old.status is not distinct from new.status
     or coalesce(current_setting('devdock.via', true), '') <> 'github'
     or not exists (select 1 from public.issues child where child.parent_id = new.id)
     or private.issue_children_complete(new.id) then
    return new;
  end if;

  with recursive descendants as (
    select i.id, i.parent_id, i.status
    from public.issues i
    where i.parent_id = new.id
    union all
    select child.id, child.parent_id, child.status
    from public.issues child
    join descendants parent on child.parent_id = parent.id
  )
  select coalesce(bool_or(d.status in ('in_progress', 'in_review')), false)
  into child_active
  from descendants d;

  new.status := case when child_active then 'in_progress' else 'todo' end;
  return new;
end;
$$;

create function private.refresh_issue_parent_status_after_pr_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_id uuid;
begin
  select i.parent_id into parent_id
  from public.issues i
  where i.id = new.issue_id;

  perform private.refresh_issue_parent_status(parent_id);
  return new;
end;
$$;

create function private.refresh_issue_parent_status_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.parent_id is distinct from new.parent_id then
    perform private.refresh_issue_parent_status(old.parent_id);
  end if;

  if tg_op = 'DELETE' then
    perform private.refresh_issue_parent_status(old.parent_id);
    return old;
  end if;

  perform private.refresh_issue_parent_status(new.parent_id);
  return new;
end;
$$;

revoke all on function private.issue_children_complete(uuid),
  private.refresh_issue_parent_status(uuid),
  private.guard_parent_completion(),
  private.refresh_issue_parent_status_after_pr_change(),
  private.refresh_issue_parent_status_after_change()
from public, anon, authenticated;

create trigger a_guard_parent_completion
  before update of status on public.issues
  for each row execute function private.guard_parent_completion();

create trigger sync_issue_parent_status
  after insert or update of status, parent_id on public.issues
  for each row execute function private.refresh_issue_parent_status_after_change();

create trigger sync_issue_parent_status_after_delete
  after delete on public.issues
  for each row execute function private.refresh_issue_parent_status_after_change();

create trigger sync_issue_parent_status_after_pr_change
  after insert or update of state on public.issue_pull_requests
  for each row execute function private.refresh_issue_parent_status_after_pr_change();
