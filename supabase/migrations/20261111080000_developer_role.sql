-- The Developer role is used only in development groups.
alter type public.team_role add value if not exists 'developer' after 'teacher';
