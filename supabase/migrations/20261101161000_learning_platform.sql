-- The learning platform (owner's choices, 2026-11-01):
-- - A group (an academy, a school) has an owner and admins who add **teachers** (team role 'teacher').
-- - Teachers create **their own courses** and add co-teachers (other teachers or admins of the group).
--   A teacher manages only the courses they lead.
-- - Students are **enrolled per course** (a workspace_members row with role member). A course is
--   *open* (anyone in the group can enroll from Browse courses) or *invite only* (the teacher adds them,
--   or gives them a course code).
-- - **Course codes** are single-use and for one course. Redeeming one joins the group (as a member) and
--   enrolls in that course, in one step. Teachers make free (fee-waived) codes now; a paid checkout will
--   issue them later.
-- - Existing courses keep everyone who could see them: those open to their group or collection have
--   those people enrolled here and become *open* courses, so nobody loses a course.
-- - The Learning page reads everything for the caller in one call (learning_overview).

-- ---------------------------------------------------------------------------------------------------
-- Teachers

create function private.is_teacher(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = t and m.user_id = (select auth.uid()) and m.role = 'teacher');
$$;
revoke all on function private.is_teacher(uuid) from public, anon, authenticated;

-- Owners and admins (and now, for teachers and members, admins too) manage who is a teacher.
drop policy "Owners and admins can add team members" on public.team_members;
create policy "Owners and admins can add team members"
  on public.team_members for insert to authenticated
  with check (
    role <> 'owner'
    and (
      private.team_role(team_id) = 'owner'
      or (private.team_role(team_id) = 'admin' and role in ('member', 'teacher'))
    )
  );

drop policy "Owners can change other members' roles" on public.team_members;
create policy "Owners change roles; admins switch members and teachers"
  on public.team_members for update to authenticated
  using (
    user_id <> (select auth.uid())
    and (
      private.team_role(team_id) = 'owner'
      or (private.team_role(team_id) = 'admin' and role in ('member', 'teacher'))
    )
  )
  with check (
    role <> 'owner'
    and (private.team_role(team_id) = 'owner' or role in ('member', 'teacher'))
  );

drop policy "Members can leave; owners and admins can remove members" on public.team_members;
create policy "Members can leave; owners and admins can remove members"
  on public.team_members for delete to authenticated
  using (
    role <> 'owner'
    and (
      user_id = (select auth.uid())
      or private.team_role(team_id) = 'owner'
      or (private.team_role(team_id) = 'admin' and role in ('member', 'teacher'))
    )
  );

-- A teacher stops leading courses when they stop being a teacher (made a member again): their
-- courses stay, with the other teachers or the group's admins.
create function private.drop_former_teacher_leads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role in ('teacher', 'admin', 'owner') and new.role = 'member' then
    update public.workspace_members wm
    set role = 'member'
    from public.workspaces w
    where wm.workspace_id = w.id and w.team_id = new.team_id and w.type = 'course'
      and wm.user_id = new.user_id and wm.role = 'lead';
  end if;
  return null;
end;
$$;
revoke all on function private.drop_former_teacher_leads() from public, anon, authenticated;

create trigger drop_former_teacher_leads
  after update of role on public.team_members
  for each row execute function private.drop_former_teacher_leads();

-- ---------------------------------------------------------------------------------------------------
-- Courses: enrollment

alter table public.workspaces
  add column enrollment text not null default 'invite'
  constraint workspaces_enrollment check (enrollment in ('invite', 'open'));

comment on column public.workspaces.enrollment is
  'Courses: open = anyone in the group can enroll (Browse courses); invite = the teachers add students or give them a course code.';

-- Creates a course. Owners, admins and teachers; the creator becomes its teacher (lead). Courses are
-- enrolled-only (access members): students are added, enroll themselves (open) or use a code.
create function public.create_course(
  p_team_id uuid,
  p_title text,
  p_description text default null,
  p_enrollment text default 'open',
  p_collection_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_caller uuid := (select auth.uid());
begin
  if not (private.is_team_admin(p_team_id) or private.is_teacher(p_team_id)) then
    raise exception 'Only teachers and the group''s owners and admins create courses' using errcode = '42501';
  end if;
  if p_enrollment not in ('invite', 'open') then
    raise exception 'Enrollment is open or invite only' using errcode = '22023';
  end if;
  if p_collection_id is not null and not exists (
    select 1 from public.workspace_collections c
    where c.id = p_collection_id and c.team_id = p_team_id
      and (private.is_team_admin(p_team_id) or exists (
        select 1 from public.workspace_collection_members cm where cm.collection_id = c.id and cm.user_id = v_caller))
  ) then
    raise exception 'Collection not found' using errcode = '22023';
  end if;

  insert into public.workspaces (team_id, title, description, type, created_by, access, collection_id, enrollment)
  values (p_team_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), 'course', v_caller, 'members', p_collection_id, p_enrollment)
  returning id into v_id;

  insert into public.workspace_modules (workspace_id, module)
  select v_id, m from unnest(public.default_workspace_modules('course')) as m
  on conflict do nothing;

  insert into public.workspace_members (workspace_id, team_id, user_id, role)
  values (v_id, p_team_id, v_caller, 'lead')
  on conflict (workspace_id, user_id) do update set role = 'lead';

  return v_id;
end;
$$;
revoke all on function public.create_course(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.create_course(uuid, text, text, text, uuid) to authenticated;

create function public.set_course_enrollment(p_workspace_id uuid, p_enrollment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_workspace(p_workspace_id)
     or not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.type = 'course') then
    raise exception 'Course not found' using errcode = '42501';
  end if;
  if p_enrollment not in ('invite', 'open') then
    raise exception 'Enrollment is open or invite only' using errcode = '22023';
  end if;
  update public.workspaces set enrollment = p_enrollment where id = p_workspace_id;
end;
$$;
revoke all on function public.set_course_enrollment(uuid, text) from public, anon;
grant execute on function public.set_course_enrollment(uuid, text) to authenticated;

-- A student enrolls in an open course of their group.
create function public.enroll_in_course(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  select w.team_id into v_team from public.workspaces w
  where w.id = p_workspace_id and w.type = 'course' and w.enrollment = 'open';
  if v_team is null or not private.is_team_member(v_team) then
    raise exception 'This course isn''t open for enrollment' using errcode = '42501';
  end if;
  insert into public.workspace_members (workspace_id, team_id, user_id, role)
  values (p_workspace_id, v_team, (select auth.uid()), 'member')
  on conflict (workspace_id, user_id) do nothing;
end;
$$;
revoke all on function public.enroll_in_course(uuid) from public, anon;
grant execute on function public.enroll_in_course(uuid) to authenticated;

-- Co-teachers: a course's teachers (or the group's admins) make another teacher or admin of the group a
-- teacher of the course, or stop them being one. A course keeps at least one teacher.
create function public.set_course_teacher(p_workspace_id uuid, p_user_id uuid, p_teacher boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  select w.team_id into v_team from public.workspaces w where w.id = p_workspace_id and w.type = 'course';
  if v_team is null or not private.can_manage_workspace(p_workspace_id) then
    raise exception 'Course not found' using errcode = '42501';
  end if;
  if p_teacher then
    if not exists (
      select 1 from public.team_members m
      where m.team_id = v_team and m.user_id = p_user_id and m.role in ('teacher', 'admin', 'owner')
    ) then
      raise exception 'Only the group''s teachers and admins can teach a course' using errcode = '22023';
    end if;
    insert into public.workspace_members (workspace_id, team_id, user_id, role)
    values (p_workspace_id, v_team, p_user_id, 'lead')
    on conflict (workspace_id, user_id) do update set role = 'lead';
  else
    if (select count(*) from public.workspace_members m where m.workspace_id = p_workspace_id and m.role = 'lead' and m.user_id <> p_user_id) = 0 then
      raise exception 'A course needs at least one teacher' using errcode = '22023';
    end if;
    delete from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role = 'lead';
  end if;
end;
$$;
revoke all on function public.set_course_teacher(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_course_teacher(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Course codes

create table public.course_codes (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null,
  workspace_id uuid not null,
  code         text not null unique,
  -- 'free' (fee waived, made by a teacher); 'paid' comes with checkout.
  kind         text not null default 'free',
  -- Who it's for, so the teacher knows ("Priya, scholarship").
  note         text,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  used_by      uuid references public.profiles (id) on delete set null,
  used_at      timestamptz,
  revoked_at   timestamptz,

  constraint course_codes_workspace_fkey foreign key (workspace_id, team_id)
    references public.workspaces (id, team_id) on delete cascade,
  constraint course_codes_kind check (kind in ('free', 'paid')),
  constraint course_codes_note_length check (note is null or char_length(note) <= 120),
  constraint course_codes_code_format check (code ~ '^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$')
);

comment on table public.course_codes is 'Single-use codes that join a group and enroll in one course. Written only by the course code functions.';

create index course_codes_workspace_idx on public.course_codes (workspace_id, created_at desc);
create index course_codes_team_idx on public.course_codes (team_id);
create index course_codes_used_by_idx on public.course_codes (used_by);
create index course_codes_created_by_idx on public.course_codes (created_by);

alter table public.course_codes enable row level security;
revoke all on public.course_codes from anon, authenticated;
grant select on public.course_codes to authenticated;

create policy "Course teachers and group admins read its codes"
  on public.course_codes for select to authenticated
  using ((select private.can_manage_workspace(workspace_id)));

-- 12 characters without look-alikes (no 0/O, 1/I/L), shown as XXXX-XXXX-XXXX like group invite codes.
create function private.new_course_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_raw text := '';
  i integer;
begin
  loop
    v_bytes := extensions.gen_random_bytes(12);
    v_raw := '';
    for i in 0..11 loop
      v_raw := v_raw || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    end loop;
    v_raw := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);
    exit when not exists (select 1 from public.course_codes c where c.code = v_raw)
          and not exists (select 1 from public.team_invites t where t.code = v_raw);
  end loop;
  return v_raw;
end;
$$;
revoke all on function private.new_course_code() from public, anon, authenticated;

-- Makes 1–50 free (fee-waived) codes for a course. Its teachers and the group's admins.
create function public.create_course_codes(p_workspace_id uuid, p_count integer default 1, p_note text default null)
returns setof public.course_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  i integer;
begin
  select w.team_id into v_team from public.workspaces w where w.id = p_workspace_id and w.type = 'course';
  if v_team is null or not private.can_manage_workspace(p_workspace_id) then
    raise exception 'Course not found' using errcode = '42501';
  end if;
  if p_count is null or p_count not between 1 and 50 then
    raise exception 'Make between 1 and 50 codes at a time' using errcode = '22023';
  end if;
  for i in 1..p_count loop
    return query
    insert into public.course_codes (team_id, workspace_id, code, kind, note, created_by)
    values (v_team, p_workspace_id, private.new_course_code(), 'free', nullif(left(btrim(coalesce(p_note, '')), 120), ''), (select auth.uid()))
    returning *;
  end loop;
end;
$$;
revoke all on function public.create_course_codes(uuid, integer, text) from public, anon;
grant execute on function public.create_course_codes(uuid, integer, text) to authenticated;

create function public.revoke_course_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.course_codes;
begin
  select * into v_code from public.course_codes c where c.id = p_code_id;
  if v_code.id is null or not private.can_manage_workspace(v_code.workspace_id) then
    raise exception 'Code not found' using errcode = '42501';
  end if;
  if v_code.used_at is not null then
    raise exception 'This code was already used' using errcode = '22023';
  end if;
  update public.course_codes set revoked_at = coalesce(revoked_at, now()) where id = p_code_id;
end;
$$;
revoke all on function public.revoke_course_code(uuid) from public, anon;
grant execute on function public.revoke_course_code(uuid) to authenticated;

-- One box for every code a person is given: a group invite joins the group; a course code joins the
-- group and enrolls in its course (and is used up). Returns { team_id, workspace_id (course codes) }.
create function public.join_with_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_digits text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_formatted text;
  v_code public.course_codes;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if char_length(v_digits) = 12 then
    v_formatted := substr(v_digits, 1, 4) || '-' || substr(v_digits, 5, 4) || '-' || substr(v_digits, 9, 4);
    select * into v_code from public.course_codes c where c.code = v_formatted for update;
  end if;

  if v_code.id is null then
    return jsonb_build_object('team_id', public.join_team(p_code), 'workspace_id', null);
  end if;

  if v_code.revoked_at is not null or (v_code.used_at is not null and v_code.used_by is distinct from v_caller) then
    raise exception 'invalid_invite' using errcode = 'P0001', hint = 'This course code was already used or was withdrawn.';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (v_code.team_id, v_caller, 'member')
  on conflict (team_id, user_id) do nothing;

  insert into public.workspace_members (workspace_id, team_id, user_id, role)
  values (v_code.workspace_id, v_code.team_id, v_caller, 'member')
  on conflict (workspace_id, user_id) do nothing;

  update public.course_codes set used_by = v_caller, used_at = coalesce(used_at, now()) where id = v_code.id;

  return jsonb_build_object('team_id', v_code.team_id, 'workspace_id', v_code.workspace_id);
end;
$$;
revoke all on function public.join_with_code(text) from public, anon;
grant execute on function public.join_with_code(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The Learning page: everything for the caller in one call.
--   teaching: courses the caller teaches (all courses for owners/admins), with their class in numbers
--   learning: courses the caller is enrolled in, with their progress and next lesson
--   browse:   open courses of the group the caller isn't in

create function public.learning_overview(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_admin boolean := private.is_team_admin(p_team_id);
  v_result jsonb;
begin
  if not private.is_team_member(p_team_id) then
    raise exception 'Group not found' using errcode = '42501';
  end if;

  with courses as (
    select w.id, w.title, w.description, w.enrollment, w.collection_id, w.updated_at,
           (select count(*) from public.lessons l where l.workspace_id = w.id) as lessons,
           (select m.role from public.workspace_members m where m.workspace_id = w.id and m.user_id = v_caller) as my_role
    from public.workspaces w
    where w.team_id = p_team_id and w.type = 'course'
  ),
  teachers as (
    select m.workspace_id, jsonb_agg(jsonb_build_object('id', m.user_id, 'name', p.display_name, 'avatar_url', p.avatar_url) order by p.display_name) as list
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.role = 'lead' and m.workspace_id in (select id from courses)
    group by m.workspace_id
  ),
  students as (
    select m.workspace_id, m.user_id,
           (select count(*) from public.lesson_progress lp where lp.workspace_id = m.workspace_id and lp.user_id = m.user_id) as done,
           (select max(lp.completed_at) from public.lesson_progress lp where lp.workspace_id = m.workspace_id and lp.user_id = m.user_id) as last_done
    from public.workspace_members m
    where m.role = 'member' and m.workspace_id in (select id from courses)
  ),
  class as (
    select c.id,
           count(s.user_id) as students,
           coalesce(round(avg(case when c.lessons > 0 then least(s.done::numeric / c.lessons, 1) * 100 end)), 0) as avg_percent,
           count(s.user_id) filter (where s.done = 0) as not_started,
           count(s.user_id) filter (where s.done > 0 and s.done < c.lessons and s.last_done < now() - interval '7 days') as stalled,
           count(s.user_id) filter (where c.lessons > 0 and s.done >= c.lessons) as finished,
           max(s.last_done) as last_activity
    from courses c
    left join students s on s.workspace_id = c.id
    group by c.id
  ),
  mine as (
    select c.id,
           (select count(*) from public.lesson_progress lp where lp.workspace_id = c.id and lp.user_id = v_caller) as done,
           (select max(lp.completed_at) from public.lesson_progress lp where lp.workspace_id = c.id and lp.user_id = v_caller) as last_done,
           (select jsonb_build_object('id', l.id, 'title', l.title)
            from public.lessons l
            join public.learning_modules lm on lm.id = l.module_id
            where l.workspace_id = c.id
              and not exists (select 1 from public.lesson_progress lp where lp.lesson_id = l.id and lp.user_id = v_caller)
            order by lm.position, l.position
            limit 1) as next_lesson
    from courses c
    where c.my_role = 'member'
  )
  select jsonb_build_object(
    'teaching', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'enrollment', c.enrollment, 'collection_id', c.collection_id,
        'lessons', c.lessons, 'teachers', coalesce(t.list, '[]'::jsonb),
        'students', k.students, 'avg_percent', k.avg_percent, 'not_started', k.not_started,
        'stalled', k.stalled, 'finished', k.finished, 'last_activity', k.last_activity,
        'unused_codes', (select count(*) from public.course_codes cc where cc.workspace_id = c.id and cc.used_at is null and cc.revoked_at is null),
        'mine', c.my_role = 'lead'
      ) order by (c.my_role = 'lead') desc, c.title)
      from courses c
      join class k on k.id = c.id
      left join teachers t on t.workspace_id = c.id
      where c.my_role = 'lead' or v_admin
    ), '[]'::jsonb),
    'learning', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'collection_id', c.collection_id, 'lessons', c.lessons,
        'done', m.done, 'last_done', m.last_done, 'next_lesson', m.next_lesson,
        'teachers', coalesce(t.list, '[]'::jsonb)
      ) order by m.last_done desc nulls last, c.title)
      from courses c
      join mine m on m.id = c.id
      left join teachers t on t.workspace_id = c.id
    ), '[]'::jsonb),
    'browse', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'description', c.description, 'collection_id', c.collection_id,
        'lessons', c.lessons, 'teachers', coalesce(t.list, '[]'::jsonb), 'students', k.students
      ) order by c.title)
      from courses c
      join class k on k.id = c.id
      left join teachers t on t.workspace_id = c.id
      where c.enrollment = 'open' and c.my_role is null and not v_admin
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.learning_overview(uuid) from public, anon;
grant execute on function public.learning_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Existing courses keep everyone who could see them: people let in by a group- or collection-wide
-- access setting are enrolled (group owners and admins excepted: they see every course anyway), and
-- the course becomes an open, enrolled-only course.

insert into public.workspace_members (workspace_id, team_id, user_id, role)
select w.id, w.team_id, tm.user_id, 'member'
from public.workspaces w
join public.team_members tm on tm.team_id = w.team_id
where w.type = 'course'
  and w.access = 'group'
  and tm.role not in ('owner', 'admin')
on conflict (workspace_id, user_id) do nothing;

insert into public.workspace_members (workspace_id, team_id, user_id, role)
select w.id, w.team_id, cm.user_id, 'member'
from public.workspaces w
join public.workspace_collection_members cm on cm.collection_id = w.collection_id
join public.team_members tm on tm.team_id = w.team_id and tm.user_id = cm.user_id
where w.type = 'course'
  and w.access = 'collection'
  and tm.role not in ('owner', 'admin')
on conflict (workspace_id, user_id) do nothing;

update public.workspaces
set access = 'members', enrollment = 'open'
where type = 'course' and access in ('group', 'collection');
