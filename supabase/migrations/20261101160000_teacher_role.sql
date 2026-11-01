-- A Teacher role for groups (owner's choice, 2026-11-01: a learning platform where a group's owner adds
-- teachers, teachers run their own courses, and students enroll per course). Its own migration because a
-- new enum value can't be used in the transaction that adds it; 20261101161000_learning_platform uses it.
alter type public.team_role add value if not exists 'teacher' after 'admin';
