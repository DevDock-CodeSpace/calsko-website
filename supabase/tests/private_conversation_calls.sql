-- Private call visibility and side effects (migration 20261119185219).
-- Run against a LOCAL or rehearsal database, never production:
--   psql "<dev or local url>" -v ON_ERROR_STOP=1 -f supabase/tests/private_conversation_calls.sql

begin;

do $$
declare
  v_owner       uuid := gen_random_uuid();
  v_member      uuid := gen_random_uuid();
  v_direct_peer uuid := gen_random_uuid();
  v_group_peer  uuid := gen_random_uuid();
  v_bystander   uuid := gen_random_uuid();
  v_team        uuid := gen_random_uuid();
  v_dm          uuid := gen_random_uuid();
  v_group       uuid := gen_random_uuid();
  v_channel     uuid;
  v_dm_call     uuid;
  v_group_call  uuid;
  v_public      uuid;
  v_fail        text[] := '{}';
  v_state       text;
  v_dm_visible  boolean;
  v_group_visible boolean;
  v_public_visible boolean;
  v_dm_event    boolean;
  v_group_event boolean;
  r record;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'private-call-' || u || '@example.test', '{}'::jsonb
  from unnest(array[v_owner, v_member, v_direct_peer, v_group_peer, v_bystander]) as u;

  insert into public.teams (id, name, slug, type, created_by)
  values (v_team, 'Private call check', 'private-call-' || left(v_team::text, 8), 'general', v_owner);
  insert into public.team_members (team_id, user_id, role)
  values (v_team, v_owner, 'owner')
  on conflict (team_id, user_id) do update set role = excluded.role;
  insert into public.team_members (team_id, user_id, role)
  values (v_team, v_member, 'member'), (v_team, v_direct_peer, 'member'),
         (v_team, v_group_peer, 'member'), (v_team, v_bystander, 'member');
  insert into public.team_feature_flags (team_id, flag, enabled)
  values (v_team, 'email_meetings', true);

  insert into public.conversations (id, team_id, kind, created_by)
  values (v_dm, v_team, 'dm', v_member);
  insert into public.conversation_members (conversation_id, team_id, user_id)
  values (v_dm, v_team, v_member), (v_dm, v_team, v_direct_peer);

  insert into public.conversations (id, team_id, kind, name, created_by)
  values (v_group, v_team, 'group', 'Private call group', v_member);
  insert into public.conversation_members (conversation_id, team_id, user_id)
  values (v_group, v_team, v_member), (v_group, v_team, v_group_peer);

  select id into v_channel
  from public.conversations
  where team_id = v_team and kind = 'channel' and lower(name) = 'general';

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_member)::text, true);
  execute 'set local role authenticated';
  execute 'insert into public.live_sessions (team_id, workspace_id, conversation_id, title, starts_at, ends_at)
           values ($1, null, $2, $3, now(), now() + interval ''1 hour'') returning id'
    into v_dm_call using v_team, v_dm, 'Call: Direct';
  execute 'insert into public.live_sessions (team_id, workspace_id, conversation_id, title, starts_at, ends_at)
           values ($1, null, $2, $3, now(), now() + interval ''1 hour'') returning id'
    into v_group_call using v_team, v_group, 'Call: Group';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_owner)::text, true);
  execute 'set local role authenticated';
  execute 'insert into public.live_sessions (team_id, workspace_id, title, starts_at, ends_at)
           values ($1, null, $2, now(), now() + interval ''1 hour'') returning id'
    into v_public using v_team, 'Group meeting';
  execute 'reset role';

  for r in
    select * from (values
      ('owner',       false, false, true,  false, false),
      ('member',      true,  true,  true,  true,  true),
      ('direct_peer', true,  false, true,  true,  false),
      ('group_peer',  false, true,  true,  false, true),
      ('bystander',   false, false, true,  false, false)
    ) as t(person, sees_dm, sees_group, sees_public, gets_dm_event, gets_group_event)
  loop
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
      case r.person when 'owner' then v_owner when 'member' then v_member when 'direct_peer' then v_direct_peer
        when 'group_peer' then v_group_peer else v_bystander end)::text, true);
    execute 'set local role authenticated';
    execute 'select exists (select 1 from public.live_sessions where id = $1),
                    exists (select 1 from public.live_sessions where id = $2),
                    exists (select 1 from public.live_sessions where id = $3),
                    exists (select 1 from public.live_session_events where session_id = $1),
                    exists (select 1 from public.live_session_events where session_id = $2)'
      into v_dm_visible, v_group_visible, v_public_visible, v_dm_event, v_group_event
      using v_dm_call, v_group_call, v_public;
    execute 'reset role';

    if v_dm_visible is distinct from r.sees_dm then
      v_fail := v_fail || format('%s DM visibility was %s, expected %s', r.person, v_dm_visible, r.sees_dm);
    end if;
    if v_group_visible is distinct from r.sees_group then
      v_fail := v_fail || format('%s group-call visibility was %s, expected %s', r.person, v_group_visible, r.sees_group);
    end if;
    if v_public_visible is distinct from r.sees_public then
      v_fail := v_fail || format('%s public meeting visibility was %s, expected %s', r.person, v_public_visible, r.sees_public);
    end if;
    if v_dm_event is distinct from r.gets_dm_event or v_group_event is distinct from r.gets_group_event then
      v_fail := v_fail || format('%s private call event visibility was DM=%s group=%s', r.person, v_dm_event, v_group_event);
    end if;
  end loop;

  -- Team membership alone cannot start a call in a private conversation.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_bystander)::text, true);
  execute 'set local role authenticated';
  begin
    execute 'insert into public.live_sessions (team_id, workspace_id, conversation_id, title, starts_at, ends_at)
             values ($1, null, $2, $3, now(), now() + interval ''1 hour'')'
      using v_team, v_dm, 'Unauthorized call';
    v_state := 'allowed';
  exception when others then
    v_state := 'refused';
  end;
  execute 'reset role';
  if v_state <> 'refused' then v_fail := array_append(v_fail, 'a chat nonmember started a private call'); end if;

  -- A channel is shared group-wide, so its call belongs to the ordinary meetings scope instead.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_member)::text, true);
  execute 'set local role authenticated';
  begin
    execute 'insert into public.live_sessions (team_id, workspace_id, conversation_id, title, starts_at, ends_at)
             values ($1, null, $2, $3, now(), now() + interval ''1 hour'')'
      using v_team, v_channel, 'Invalid channel call';
    v_state := 'allowed';
  exception when others then
    v_state := 'refused';
  end;
  execute 'reset role';
  if v_state <> 'refused' then v_fail := array_append(v_fail, 'a channel was accepted as a private call'); end if;

  -- A group admin must not use a private call id to obtain a whole-group email audience.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_owner)::text, true);
  execute 'set local role authenticated';
  begin
    perform * from public.live_session_invitees(v_dm_call);
    v_state := 'allowed';
  exception when others then
    v_state := 'refused';
  end;
  execute 'reset role';
  if v_state <> 'refused' then v_fail := array_append(v_fail, 'a group owner obtained invitees for a private call'); end if;

  if exists (select 1 from public.email_outbox where ref_id in (v_dm_call, v_group_call) and kind = 'meeting_created') then
    v_fail := array_append(v_fail, 'a private call was queued as a whole-group meeting email');
  end if;
  if not exists (select 1 from public.email_outbox where ref_id = v_public and kind = 'meeting_created') then
    v_fail := array_append(v_fail, 'a normal meeting no longer queues its expected email');
  end if;

  if cardinality(v_fail) > 0 then raise exception 'Private call checks failed: %', array_to_string(v_fail, '; '); end if;
  raise notice 'Private conversation call checks passed';
end;
$$;

rollback;
