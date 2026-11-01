# Calsko (formerly DevDock)

A private workspace for one instructor and a few students (single digits): chat, files, whiteboards, issues, meetings, lessons.
Optimize for clarity, low maintenance and low hosting cost over scale. Live at `www.calsko.com`; old dev-dock.com addresses redirect.
UI words differ from code words; keep new text on the UI word, don't rename code: group = `team`, sprint = `cycle`, Whiteboard = diagram,
Chat = messages, Files = docs + diagrams, Notes = reminders, Meetings = live sessions, Starred = pins, Calsko AI = Ask DevDock.
Code names, storage keys (`devdock:…`), `ask_devdock`, `devdock.via`, `.ics` UIDs and the `dock/` branch prefix keep "devdock" on purpose.

## Stack
React 19 + TypeScript (strict) + Vite SPA, React Router (data mode), Tailwind v4, shadcn/ui (`radix-nova`), TanStack Query, Supabase
(Postgres, Auth, Storage, Realtime, Edge Functions, pg_cron), TipTap v3 (MIT only), React Flow, Jitsi via JaaS, a GitHub App, Gemini.
Hosting: Vercel (SPA). `.github/workflows/deploy-supabase.yml` deploys migrations + Edge Functions: `dev` → DevDock Dev, `prod` → live.

## Commands
`npm run dev` (against DevDock Dev) · `dev:live` · `check` (lint + typecheck + build + perf budget; must pass before done; CI runs it)
`test:ai` · `test:idle` · `test:reminders` · `test:mermaid` · `test:import` · `test:errors` (Deno) · `db:types` (regenerate types) · `seed:dev`.

## Must-follow rules
- **Performance:** read `.claude/skills/devdock-performance/SKILL.md` before any fetching, route, list, query, dependency or editor work.
  No waterfalls (prefetch in loaders), no N+1, lazy-load heavy code with `preloadable()`, first-load JS ≤ 345 KB gz. Ask the owner first
  if a change adds requests to every page, >10 KB to the first load, polling or unbounded lists.
- **Data access:** components never import `supabase`; go through a feature `api.ts` (`queryOptions` + mutations) and TanStack hooks.
  Errors via `lib/errors.ts` (`toDataError`, `requireAffected`: RLS turns forbidden writes into 0 rows) and `toast.error(errorMessage(e))`.
- **Shell data starts in loaders** (`appLoader`, `teamLoader`), never in mounted components. Pages read with `useSuspenseQuery(ies)`.
- **Live updates:** a new table needs an `AFFECTS` entry in `lib/realtime.ts` and a publication migration; own writes use
  `ownSave`/`ownWrite`. Editors keep a `synced` copy and lock while someone else types (`useOthersTyping`).
- **`can` (from `useCurrentTeam/Workspace`) only shows/hides UI;** RLS decides. Access to a workspace goes through
  `private.workspace_role()` / `can_view_workspace` / `has_workspace_access`, never `workspace_members` directly.
- **Group-level lists** read `useCollectionView()` (one collection at a time); Chat, Members, Settings and Notes are never narrowed.
- **Leaving/deleting** the current group or workspace: navigate away first, then invalidate. Avoid `Date.now()` in render.
- **Style:** Tailwind only, semantic tokens, no backdrop blur, brand blue as accent only, logo only via `LogoMark`/`LogoWordmark`.
  Lists and hairlines over cards; content uses the full width. `DockSpinner` for page-long waits.

## Supabase
- Two projects: **Dev** `aktqcsncvbmkbleghipb` (test data; build and test here) and **live** `ejqrrxxiatvvdiyxtvid` (real people).
  The repo is linked to live: push to dev with `--db-url`. Pushing to live by hand needs a backup and the owner's OK. Never copy live data.
- Schema only through append-only migrations (`supabase migration new`). Every table: RLS on, policies per operation `to authenticated`,
  `(select auth.uid())`, grants revoked then granted narrowly. Functions: `search_path = ''`, `security definer` only when needed.
- After a migration: push, `npm run db:types`, commit both. Never hand-edit `src/types/database.types.ts`.
- Frontend uses the publishable key only; no secret keys, service-role keys or passwords in code or `VITE_` vars.

## Auth
Google and Microsoft via Supabase Auth (PKCE), plus one password admin account at `/admin-login`. All auth calls in
`features/auth/api.ts`; routes are protected in loaders (`requireUser`), never in components. Sessions: per tab by default, 4 h
(12 h with Remember me); 15 min inactivity signs out. Never call Supabase inside `onAuthStateChange`. Show friendly errors only.

## Git and more detail
Default branch `prod`; feature branches, PRs to `dev`. Don't commit before testing in a browser and the owner says so.
`docs/AI_AGENT.md` (Calsko AI) · `docs/ERROR_TRACKING.md` (error trackers → issues; a new provider is one file) · `docs/REMINDERS.md` (Notes) · `docs/MESSAGING_ARCHITECTURE.md` (Chat) · `docs/ISSUES_HUB_PLAN.md`
(Plans, hub) · `docs/DEV_ENVIRONMENT.md` · `docs/STATUS.md` · `README.md` (setup) · `brand/README.md`.
