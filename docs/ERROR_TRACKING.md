# Error tracking

Errors from an error tracker become issues in a project. The owner chose this design on 2026-11-01.

- A new kind of error gets an issue. AI writes it, and the exact error is copied below what the AI wrote.
- The same error happening again only adds to its count while its issue is open.
- An error that comes back after its issue was **Done** gets a new issue that links to the old one ("Came back after QB-12").
- A **Canceled** issue means "won't fix", so its error is only counted.
- Calsko does the work once a day, never once per error.

Flags:
- `error_tracking` (off by default) switches the feature on per group, in the admin console.
- `error_tracking_ai` is its sub-feature for AI-written issues (on by default while the parent is on).

## How it works

```
 PostHog ──(daily pull, API key)──┐
                                   ├─► error_record() ─► error_groups (one row per kind of error)
 any tool ──(webhook, token)──────┘                        error_group_days (count per UTC day)
                                                                   │
                       error-sync, daily 06:00 UTC (pg_cron → pg_net), or "Sync now"
                                                                   ▼
                                  AI (or the template) writes it ─► error_create_issue() ─► issues
```

**Sources** (`error_sources`): an error tracker connected to a project.
- They're managed in Project settings → Error tracking, by the project's leads and the group's owners and admins (`private.can_manage_workspace`). Nobody else can read them.
- Each source has non-secret settings in `config`, checked per provider by `private.check_error_source_config`.
- Secrets live in `private.error_source_secrets`:
  - the API key in Supabase Vault (`api_key_id`);
  - the webhook token only as a SHA-256 hash.
- The browser never reads a secret back. Deleting the source deletes its Vault secret too.

**Errors** (`error_groups`): one row per source and fingerprint.
- Each row holds the latest exact error (`raw`), the link back to the tracker, first and last seen, `total_count`, the issue it has (`issue_id`) and the Done issue it came back after (`previous_issue_id`).
- Only the `error_*` functions write it.
- Everyone who can see the project reads it. The issue page embeds it in `issueQuery`, so it costs no extra request.

**What the functions do**:
- `error_record(source, reports)` adds counts and flags errors that need an issue: new ones, ones whose issue was deleted, and ones back after Done.
- `error_create_issue(group, title, description, priority)`:
  - makes the issue in Backlog, with the source's label or the project's **Error** label (made when missing);
  - sets `devdock.via = 'errors'`, so Activity shows "Error tracking";
  - links the error to the new issue.
- Only the service role can call them.

**Edge Functions**:
- `error-sync` handles the daily run and Sync now.
  - The daily run comes from cron with header `x-worker-secret`.
  - Sync now comes from a person's token with `{ source_id }`. `request_error_sync` checks, as that person, that they manage the project and haven't synced it in the last 10 minutes.
  - For each source it:
    1. pulls the errors since the last sync (the first sync looks 7 days back);
    2. records them;
    3. writes at most 20 issues, 4 AI calls at a time;
    4. stores the result on the source (`last_sync_ok`, `last_sync_message`).
- `error-intake` is the webhook receiver. It checks the token, parses the payload and calls `error_record`: one database call per request, no AI, no issue.

**AI** (`_shared/error-tracking/describe.ts`):
- It uses the same provider as Calsko AI (`ai-agent/providers`) and asks for JSON: title, summary, likely cause, where to look, priority.
- The description is TipTap JSON: what the AI wrote, then **Error** with the exact text in a code block, the counts, a link to the tracker, and a line saying the AI's part should be checked.
- If the AI fails, or `error_tracking_ai` is off, the plain template is used (the error message becomes the title).
- An error is never lost because of the AI.

## Providers

Everything after a provider is shared. A provider only turns what its tool has into `ErrorReport`s (`_shared/error-tracking/types.ts`): one per kind of error, with counts per day.

| Provider | Way in | Fingerprint |
|---|---|---|
| `posthog` | Daily pull: HogQL over `$exception` events since the last sync, grouped by `$exception_issue_id` and day | `ph_<PostHog issue id>`, so Calsko's grouping matches PostHog's |
| `webhook` | Push, in Calsko's own format (below) | `ext_<theirs>` when the sender gives one, otherwise ours (`fingerprint.ts`) |

**Our fingerprint** (`fingerprint.ts`) is for tools that don't group errors themselves:
- It uses the error type, the message with ids, numbers, emails, hex and quoted values taken out, and the top 3 stack frames as `function@file`, without line numbers or bundle hashes.
- So "User 123 not found" and "User 456 not found" are one error, and so is the same crash after a deploy.

**Adding a provider** (Sentry, Rollbar, Bugsnag, Datadog, New Relic, CloudWatch, Azure, Google Cloud, Firebase…):
1. Write `supabase/functions/_shared/error-tracking/providers/<name>.ts`. It's an `ErrorProvider` with `pull()` (API) and/or `parseWebhook()` (its own webhook payload), and it throws `SourceProblem` for things the person can fix (wrong key, wrong project).
2. Add one line to `providers/index.ts`.
3. Write a migration that adds the name to the `error_sources_provider` check and its settings to `private.check_error_source_config`. Settings hosts are fixed lists: the server fetches them, so they're never free-form URLs.
4. Add the settings form to `ConnectErrorSourceDialog`.
5. Add tests to `error-tracking.test.ts`, with a sample payload or response.

For raw-log sources (CloudWatch Logs Insights, Azure Log Analytics), a pull that groups by message and calls `fingerprint()` is the pattern.

## The webhook

```
POST https://<project>.supabase.co/functions/v1/error-intake?source=<source id>
x-calsko-token: <token>          (or Authorization: Bearer <token>, or &token=<token> in the URL)
Content-Type: application/json

{ "errors": [ {
    "title": "TypeError: x is undefined",     // or "message" (one of the two is required)
    "type": "TypeError", "message": "x is undefined",
    "stack": "…", "page": "https://…", "link": "https://tracker/…",
    "fingerprint": "abc", "count": 3, "timestamp": "2026-11-01T10:00:00Z",
    "environment": "production", "release": "1.4.2", "details": "anything else (string or object)"
} ] }
```

- A single error object, without the `errors` list, works too.
- At most 100 errors and 1 MB per request.
- Answers: `202 { recorded }`, `400` unreadable, `401` wrong source or token, source switched off, or the group's flag off.
- Send a tracker's **alerts** (new error, regression, spike) or batches, not one request per occurrence.

## Setup per Supabase project

- **The daily run** needs these, run by hand like the email worker:

  ```sql
  select vault.create_secret('https://<ref>.supabase.co/functions/v1/error-sync', 'error_sync_url');
  select vault.create_secret('<random>', 'error_sync_secret');
  ```

  plus the function secret `ERROR_SYNC_SECRET` with the same random value. Without them nothing is pulled and no issues are written, but webhooks are still counted and Sync now still works.
- **AI-written issues** need `GEMINI_API_KEY` (shared with Calsko AI). Without it the template is used.
- **The PostHog key** comes from the person connecting it: a personal API key with **Query: Read** for that project (PostHog → Settings → Personal API keys). It's limited by PostHog's query API (10 s per query, 240 requests a minute).

## Tests

- `npm run test:errors` (Deno, no database): fingerprints, the webhook format, PostHog rows and request, the issue template, the AI reply and the description.
- `psql "<dev or local URL>" -f supabase/tests/error_tracking.sql`: 54 checks covering access, secrets, counting, issues, regressions, Canceled, Sync now and removal. It rolls back.

## Cost

- One cron run a day. Each source costs one function call a day, and one per webhook request.
- AI runs once per new issue, at most 20 per source a day. That's about $0.0005 each on `gemini-3.5-flash-lite`.
- Error counts are kept 90 days (`error_group_days`, trimmed by the daily kick).
