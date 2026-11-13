# Calsko (formerly DevDock)

A private software-engineering teaching workspace for one instructor and a few students. React + TypeScript + Vite,
React Router, Tailwind, shadcn/ui, TanStack Query; Supabase backend; hosted on Vercel at `www.calsko.com`.

## Running it

```bash
npm install
npm run dev     # http://localhost:5173, against the DevDock Dev project (docs/DEV_ENVIRONMENT.md)
npm run check   # lint, typecheck, build and performance budget; CI runs it on every PR
```

Node 22 LTS is recommended (supabase-js is pinned to a version that still runs on Node 20).
## Environment variables

Copy `.env.example` to `.env.local`. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Supabase → Project Settings → API)
are required; `VITE_GITHUB_APP_SLUG` (shows Connect GitHub) and `VITE_INACTIVITY_LIMIT_MINUTES` are optional.
Everything prefixed `VITE_` reaches the browser: **never** put a secret key, `service_role` key or DB password there.
Server secrets (JaaS, GitHub App, Gemini) are Edge Function secrets: `supabase secrets set NAME=value`.

## Database

- The schema lives in `supabase/migrations/` (append-only; never edit the dashboard). New one: `supabase migration new <name>`.
- Every table enables RLS in the migration that creates it; RLS is the security boundary, not the publishable key.
- After a migration: `supabase db push` (`--db-url` for Dev), then `npm run db:types` and commit the generated types.
- Pushes to `dev`/`prod` deploy migrations and Edge Functions automatically (`.github/workflows/deploy-supabase.yml`).

## Sign-in setup

- **Google Cloud → Google Auth Platform:** External app; scopes `openid`, `email`, `profile` (+ `calendar.events` for Calendar sync).
  Web client: JS origin = each site origin; redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`.
- **Microsoft Entra:** app for "any Entra tenant + personal accounts", redirect URI = the same Supabase callback, tenant URL `/common`.
- **GitHub (sign-in):** an **OAuth App** (Settings → Developer settings → OAuth Apps; not the DevDock GitHub App, which only
  connects repos). Homepage = the site; Authorization callback URL = the same Supabase callback. One OAuth App per Supabase
  project (Dev and live), because GitHub allows one callback URL per OAuth App.
- **Supabase → Authentication:** enable the providers with their client IDs and secrets (dashboard only). Site URL =
  `https://www.calsko.com`; Redirect URLs = each origin's `/auth/callback` (and Vercel previews). The app always uses
  `window.location.origin + '/auth/callback'`.

## GitHub App setup

1. GitHub → Developer settings → GitHub Apps → New. Callback URL `<origin>/github/callback`; tick "Request user authorization
   during installation"; webhook URL `https://<project-ref>.supabase.co/functions/v1/github-webhook` with a secret; subscribe to
   **Pull request**; permissions Contents read/write, Issues read/write, Pull requests read-only.
   Connect GitHub starts with GitHub sign-in for the App (it returns to the Callback URL, the first one if there are
   several), then offers the accounts that already have the App, or goes on to install it. The install page alone never
   comes back when the App is already on the account.
2. Note the App ID and Client ID, generate a client secret and a private key, convert the key:
   `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key-pkcs8.pem`.
3. `supabase secrets set GITHUB_APP_ID=… GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… GITHUB_WEBHOOK_SECRET=…` and
   `GITHUB_APP_PRIVATE_KEY="$(cat key-pkcs8.pem)"`; delete the `.pem` files. Set `VITE_GITHUB_APP_SLUG` in Vercel.

Calsko creates a matching GitHub issue when an issue is created with a connected repo, then mirrors parent/sub-issue
relationships from Calsko. Calsko remains the source of truth for nesting and statuses; changes made directly on GitHub
are not imported. Parent and child must use the same connected repo. GitHub issue titles are created from the Calsko
identifier and title; later title or description edits are not synced. Existing Calsko issues are not backfilled
automatically. In Calsko, a parent moves to In Progress when any descendant starts and is automatically marked Done only
after all descendants are Done and each leaf issue has a merged pull request. Workspace managers can manually mark an
issue, including a parent, Done earlier.

## Meetings and calendars
Add-to-calendar links and `.ics` downloads need no setup. Google Calendar sync needs the sensitive `calendar.events` scope:
publish the consent screen to stop weekly re-approval. Outlook sync was rejected (needs a verified Microsoft publisher).
