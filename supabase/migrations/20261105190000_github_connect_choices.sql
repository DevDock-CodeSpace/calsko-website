-- Connecting a GitHub account that already has the Calsko App installed.
--
-- GitHub only sends people back to Calsko after a *new* install. When the App is
-- already on the account (installed for another group, or an earlier attempt),
-- GitHub opens the installation's settings instead and stays there, so the group
-- never got connected. Connect now starts with GitHub sign-in, which always comes
-- back: the github Edge Function lists the installations that person can reach
-- and keeps them here, on the one-time state, until they pick one (or go on to
-- install the App on another account with the same state).

alter table public.github_connect_states
  add column installations jsonb;

comment on column public.github_connect_states.installations is
  'Installations the person was shown to pick from: [{ id, login, type }], verified with their GitHub token. Written only by the github Edge Function.';
