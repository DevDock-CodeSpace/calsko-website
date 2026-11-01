# Calsko: project status

_Last updated: 2026-11-01. The full phase-by-phase history is in git (`git log -- docs/STATUS.md`)._

## Where things stand

Live at `www.calsko.com` (renamed from DevDock on 2026-10-29; dev-dock.com redirects). Every feature below is built and on `prod`
unless it says otherwise. Conventions live in [CLAUDE.md](../CLAUDE.md); setup in [README.md](../README.md).

| Area | State |
|---|---|
| Groups, collections, workspaces (courses, projects, spaces), invites, roles, access settings | Built |
| Sign-in: Google, Microsoft, password admin account; per-tab sessions, inactivity sign-out | Built |
| Chat: channels, DMs, groups, threads, reactions, pins, mentions, attachments, search, unread | Built |
| Files: docs (TipTap) and whiteboards (React Flow, free drawing, Mermaid import) in shared folders | Built |
| Issues: list/board, sprints, views, activity, shortcuts, import (CSV/Linear/Notion/Jira), Plans, Issues hub, Starred | Built |
| GitHub: repos linked to projects, App connection, branch on In Progress, PR webhooks move issues | Built |
| Meetings: Jitsi via JaaS, repeating meetings, calendar view, .ics, Google Calendar sync and RSVPs | Built |
| Learning: modules, lessons, progress, a whiteboard per lesson | Built |
| Learning platform: Teacher role, teachers create courses and co-teachers, per-course enrollment (open / invite only), single-use course codes (fee waived), Learning page (Teaching / My learning / Browse), public course catalog (price ₹/$, publish, /learn pages; free courses joinable, paid via codes until checkout); [LEARNING_PLATFORM.md](LEARNING_PLATFORM.md) | Catalog on branch `feat/course-catalog` |
| Notes: private notes with an optional time that pops up (pg_cron → bell) | Built |
| Calsko AI: assistant that works through the app's own tools (flag `ask_devdock`) | Built |
| Platform admin console, per-group feature flags | Built |
| Feedback button, read in the admin console | On `dev`, not yet on `prod` |
| Calsko name, logo, favicons, whirl spinner | On `dev`, not yet on `prod` |
| Invite emails: Members → Email invites, a single-use code per address, sent with Resend (`invite-email`) | Branch `feat/invite-emails` |
| Email notifications: note reminders, new feedback (to support@), meeting invites/changes/cancellations and unread chat (built, flags off); Email settings in the profile menu | Branch `feat/email-notifications` |
| Feature flags can have sub-features (`feature_flags.parent`, one level; on only while the parent is on); `email` → `email_invites`, `email_reminders`, `email_feedback`, `email_meetings`, `email_chat` | Branch `feat/email-notifications` |
| Error tracking: PostHog and Sentry (daily pull) or any webhook → counted issues, AI-written with the exact error below (flags `error_tracking`, `error_tracking_ai`); [ERROR_TRACKING.md](ERROR_TRACKING.md) | Built (Sentry on `feat/error-tracking-sentry`) |

## Next

- 9e: deleting an issue can delete its branch (opt-in). Branches are never deleted when an issue moves back.
- Files: "Convert to diagram" on Mermaid code blocks, then "Linked from" on the whiteboard page.
- Chat: instant calls from a conversation (needs its own audience rule in `jaas-token`); revoke the old column UPDATE grant
  on `public.messages` once every open client uses `edit_message`/`delete_message`.
- Learning platform next: checkout issuing paid codes (Razorpay). Exercises is still a placeholder page.
- Issue display options (group by, sub-group, ordering, properties) are not built.
- Error tracking: more providers (Rollbar/Bugsnag/Datadog/New Relic, then CloudWatch/Azure/Google), and closing an issue resolving the error in the tracker.

## Known gaps

- A member can clear an issue's repo and then set Done by hand (the status lock only applies with a connected repo).
- `/privacy` doesn't yet say that note titles reach the model when Calsko AI is asked about them (owner deferred).
- Notes: in-app only (no email or push), one-minute resolution, no recurring notes.
- Issues pages load every issue of a workspace in one query; revisit before a workspace passes ~500 issues.
- The Ninety (EOS) sync was built on `feat/ninety-sync` and shelved (2026-10-29); its `ninety_sync` flag reads nothing.

## Environments

Live Supabase `ejqrrxxiatvvdiyxtvid`, Dev `aktqcsncvbmkbleghipb` (see [DEV_ENVIRONMENT.md](DEV_ENVIRONMENT.md)). GitHub repo
`DevDock-CodeSpace/calsko-website`.

Email: calsko.com sends through **Resend** (DKIM/SPF on the `send` subdomain, verified) and receives through **ImprovMX**
(root MX; the `support@` alias forwards to the owner, and more recipients are added in ImprovMX). DMARC is `p=none`. Invites
go out from `invites@calsko.com`, everything else from `notifications@calsko.com`, all with Reply-To `support@calsko.com`
(feedback emails reply to the sender).

How notifications are sent: triggers queue one row per event in `email_outbox` (service role only); the pg_cron job
`kick-email-worker` calls the `send-emails` function through pg_net, only when something is due; the function claims a batch
(`email_claim_batch`, which reads recipients, settings and addresses at send time), sends through Resend and reports back
(`email_finish_batch`, two retries). Meeting emails wait 2 minutes so quick edits become one email; meetings synced to Google
Calendar are left to Google's invites. At most 90 recipients a day (Resend free plan: 100). People switch reminder and
meeting emails off in `email_settings` (profile menu → Email), which also keeps their time zone, saved at sign-in.

Secrets per project: function secrets `RESEND_API_KEY`, `EMAIL_WORKER_SECRET`, optional `APP_URL` (Dev:
`http://localhost:5173`), `EMAIL_FROM`, `INVITE_FROM`, `EMAIL_REPLY_TO`, `FEEDBACK_EMAIL_TO`; Vault secrets
`email_worker_url` (`https://<ref>.supabase.co/functions/v1/send-emails`) and `email_worker_secret` (= `EMAIL_WORKER_SECRET`).
Without the Vault secrets the queue waits; nothing is lost.

Analytics and error tracking: **PostHog** (`src/lib/error-tracking.ts`): page views and errors (no clicks, replay or
cookies). Vercel variable `POSTHOG_KEY` (the project's public `phc_` key, passed to the bundle by name in `vite.config.ts`),
set for Production only (previews and Dev don't report); the host is US. posthog-js (~100 KB gz, own chunk) loads in the
background after the first paint (owner's choice, 2026-10-30), so first-load size is unchanged; one `$pageview` per route
change plus `$pageleave`, session per tab (sessionStorage). Errors: uncaught errors and rejections, route error pages, React
root errors, failed Supabase calls (`toDataError`, skipped offline) and `logError` (caught failures);
`supabase_project` tells Dev from live; people are identified by user id only. The browser sends through `/_relay` on our
own domain (a `vercel.json` rewrite to `us.i.posthog.com`, `:path(.*)` so `/e/` matches), so ad blockers don't drop
events. Edge Functions report errors too (`supabase/functions/_shared/report-errors.ts`, one
`startErrorReporting('<name>')` per function): every `console.error` and anything uncaught, sent in the background with
`EdgeRuntime.waitUntil`, tagged `function`; needs the function secret `POSTHOG_KEY` (live only). Stack traces are minified
until source maps are uploaded to PostHog (not set up yet).

Each email kind is a sub-feature of the `email` flag, per group (/admin → Feature flags): checked when it is queued and
again when it is sent. `email_meetings` is off by default: meeting invites go through Google Calendar for now, and Calsko's
own would double them. `email_chat` is off by default too: one email per conversation for mentions, DMs and replies
still unread after 30 minutes (reading them first cancels it; muted conversations never email). Request counts are tested from the private `DevDock-request-tests` repo after each `prod` push.
