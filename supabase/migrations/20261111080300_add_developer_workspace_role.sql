-- Workspace Developers have member access plus permission to schedule meetings in their Space.
alter type public.workspace_role add value if not exists 'developer' after 'lead';
