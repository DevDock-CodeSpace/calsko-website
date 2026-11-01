-- The public course catalog (owner's choice, 2026-11-01). No payments yet: paid courses show their price
-- and take course codes; checkout will issue paid codes later.
--
-- - A course has a listing: published (or draft), a price in rupees and in US cents (null = free).
-- - The course's teachers set it and publish, unless the group says only owners and admins set prices
--   (teams.teachers_set_prices). Owners and admins can always change any course.
-- - Published courses are public: /learn/<group> lists them, /learn/<group>/<course> shows one with its
--   outline (module and lesson titles only, never lesson text) and its teachers' names and pictures.
--   Read through public_catalog / public_course (security definer, callable without signing in), which
--   return only those fields of published courses.
-- - A published free course can be joined by anyone signed in (enroll_published_course): it joins the
--   group as a member and enrolls in that course. Paid ones are joined with a course code.

alter table public.workspaces
  add column published boolean not null default false,
  add column published_at timestamptz,
  add column price_inr integer,
  add column price_usd_cents integer,
  add constraint workspaces_price_inr check (price_inr is null or price_inr between 1 and 10000000),
  add constraint workspaces_price_usd check (price_usd_cents is null or price_usd_cents between 1 and 100000000),
  add constraint workspaces_published_course check (not published or type = 'course');

comment on column public.workspaces.published is 'Courses: listed in the group''s public catalog (/learn/<group>).';
comment on column public.workspaces.price_inr is 'Courses: price in whole rupees; null = free in India.';
comment on column public.workspaces.price_usd_cents is 'Courses: price in US cents; null = free elsewhere.';

create index workspaces_published_idx on public.workspaces (team_id) where published;

alter table public.teams
  add column teachers_set_prices boolean not null default true;

comment on column public.teams.teachers_set_prices is 'Whether teachers price and publish their own courses (else only owners and admins).';

grant update (teachers_set_prices) on table public.teams to authenticated;

-- A course's listing. Its teachers (if the group lets them) and the group's owners and admins.
create function public.set_course_listing(p_workspace_id uuid, p_published boolean, p_price_inr integer, p_price_usd_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course public.workspaces;
  v_let_teachers boolean;
begin
  select * into v_course from public.workspaces w where w.id = p_workspace_id and w.type = 'course';
  if v_course.id is null or not private.can_manage_workspace(p_workspace_id) then
    raise exception 'Course not found' using errcode = '42501';
  end if;
  select t.teachers_set_prices into v_let_teachers from public.teams t where t.id = v_course.team_id;
  if not private.is_team_admin(v_course.team_id) and not v_let_teachers then
    raise exception 'In this group only the owners and admins price and publish courses' using errcode = '42501';
  end if;
  if (p_price_inr is not null and p_price_inr not between 1 and 10000000)
     or (p_price_usd_cents is not null and p_price_usd_cents not between 1 and 100000000) then
    raise exception 'Prices are whole rupees and dollars and cents above zero; leave one empty for free' using errcode = '22023';
  end if;
  if p_published then
    if char_length(btrim(coalesce(v_course.description, ''))) < 20 then
      raise exception 'Add a description (what students will learn) in the course settings before publishing' using errcode = '22023';
    end if;
    if not exists (select 1 from public.lessons l where l.workspace_id = p_workspace_id) then
      raise exception 'Add at least one lesson before publishing' using errcode = '22023';
    end if;
  end if;
  update public.workspaces
  set published = p_published,
      published_at = case when p_published then coalesce(published_at, now()) else published_at end,
      price_inr = p_price_inr,
      price_usd_cents = p_price_usd_cents
  where id = p_workspace_id;
end;
$$;
revoke all on function public.set_course_listing(uuid, boolean, integer, integer) from public, anon;
grant execute on function public.set_course_listing(uuid, boolean, integer, integer) to authenticated;

-- The people shown on a public course page: its teachers' names and pictures.
create function private.public_teachers(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'avatar_url', p.avatar_url) order by m.joined_at), '[]'::jsonb)
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace_id and m.role = 'lead';
$$;
revoke all on function private.public_teachers(uuid) from public, anon, authenticated;

-- /learn/<group>: the group's name and logo and its published courses. Empty when it has none.
create function public.public_catalog(p_team_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'group', jsonb_build_object('name', t.name, 'slug', t.slug, 'logo_path', t.logo_path),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'description', w.description,
        'price_inr', w.price_inr, 'price_usd_cents', w.price_usd_cents,
        'lessons', (select count(*) from public.lessons l where l.workspace_id = w.id),
        'teachers', private.public_teachers(w.id)
      ) order by w.published_at desc)
      from public.workspaces w
      where w.team_id = t.id and w.type = 'course' and w.published
    ), '[]'::jsonb)
  )
  from public.teams t
  where t.slug = lower(p_team_slug)
    and exists (select 1 from public.workspaces w where w.team_id = t.id and w.published);
$$;
revoke all on function public.public_catalog(text) from public;
grant execute on function public.public_catalog(text) to anon, authenticated;

-- /learn/<group>/<course>: one published course (or a draft, for those who can publish it), its outline
-- (titles only) and teachers, and for a signed-in visitor whether they're already in it.
create function public.public_course(p_team_slug text, p_course_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'group', jsonb_build_object('name', t.name, 'slug', t.slug, 'logo_path', t.logo_path),
    'course', jsonb_build_object(
      'id', w.id, 'title', w.title, 'description', w.description, 'published', w.published,
      'price_inr', w.price_inr, 'price_usd_cents', w.price_usd_cents,
      'teachers', private.public_teachers(w.id),
      'outline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'title', lm.title,
          'lessons', coalesce((select jsonb_agg(l.title order by l.position) from public.lessons l where l.module_id = lm.id), '[]'::jsonb)
        ) order by lm.position)
        from public.learning_modules lm where lm.workspace_id = w.id
      ), '[]'::jsonb)
    ),
    'enrolled', (select auth.uid()) is not null and exists (
      select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = (select auth.uid())
    ) or (select auth.uid()) is not null and private.is_team_admin(t.id)
  )
  from public.workspaces w
  join public.teams t on t.id = w.team_id
  where w.id = p_course_id and t.slug = lower(p_team_slug) and w.type = 'course'
    -- A draft shows only to those who can publish it (a preview).
    and (w.published or ((select auth.uid()) is not null and private.can_manage_workspace(w.id)));
$$;
revoke all on function public.public_course(text, uuid) from public;
grant execute on function public.public_course(text, uuid) to anon, authenticated;

-- Joining a published free course from its public page: the group as a member, and the course.
create function public.enroll_published_course(p_course_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course public.workspaces;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_course from public.workspaces w where w.id = p_course_id and w.type = 'course' and w.published;
  if v_course.id is null then
    raise exception 'This course isn''t open for enrollment' using errcode = '42501';
  end if;
  if v_course.price_inr is not null or v_course.price_usd_cents is not null then
    raise exception 'This course is paid: enroll with a course code' using errcode = '22023';
  end if;
  insert into public.team_members (team_id, user_id, role)
  values (v_course.team_id, v_caller, 'member')
  on conflict (team_id, user_id) do nothing;
  insert into public.workspace_members (workspace_id, team_id, user_id, role)
  values (p_course_id, v_course.team_id, v_caller, 'member')
  on conflict (workspace_id, user_id) do nothing;
  return (select t.slug from public.teams t where t.id = v_course.team_id);
end;
$$;
revoke all on function public.enroll_published_course(uuid) from public, anon;
grant execute on function public.enroll_published_course(uuid) to authenticated;

-- The Learning page's Teaching rows say whether a course is published and what it costs.
create or replace function public.learning_overview(p_team_id uuid)
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
           w.published, w.price_inr, w.price_usd_cents,
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
        'mine', c.my_role = 'lead',
        'published', c.published, 'price_inr', c.price_inr, 'price_usd_cents', c.price_usd_cents
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
