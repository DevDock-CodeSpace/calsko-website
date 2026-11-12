# Chat feeds

Bots that post into a group's chat channels, like a Slack or Teams channel that apps and alarms write to. The owner chose
this design on 2026-11-08. Behind the `chat_feeds` flag (off by default; the platform admin switches it per group).

```
 Calsko events (triggers) ─────────────┐
 error-sync, after each source's run ──┼─► private.chat_post() ─► messages (author_id null, bot {…}) ─► the feed's channel
 outside tools ─► chat-intake ─────────┘        hourly cap, critical → 'alert' notifications
```

## Feeds (`chat_feeds`)

Group owners and admins manage them in **Group settings → Chat feeds**. Each feed posts into one **target**, which decides
who sees it:

- a **channel**: the whole group (`#activity` is made the first time a feed is switched on without a target being chosen);
- a **private group conversation**: only its people ("chosen people"). Only conversations the admin is in can be chosen
  (`private.chat_target_ok`). The settings can make one, optionally starting from a project's members (copied once, not
  kept in step: people who join the project later are added by hand).

Each Calsko event can go to its own target (`event_targets`, event → conversation); the rest go to the feed's
`conversation_id`. A target that's archived or gone falls back to the feed's own.

| Kind | How many | What it posts |
|---|---|---|
| `events` | one per group | Issue created, issue completed or canceled, meeting scheduled or cancelled (one message per repeating series), plan created, someone joined. Which ones: `events`. |
| `errors` | one per group | Error tracking's summary per source after each run: kinds of error seen, new issues (up to 10 listed), or that the sync failed. Nothing when nothing happened. |
| `webhook` | up to 20 per group | Whatever an outside tool sends to its URL. |

**Who can see what** (`private.chat_target_covers`). News about a project goes to a target only when everyone who reads
the target may see it: the project is open to the whole group (`access = 'group'`); or an admin ticked it in the feed
(`projects`; the settings warn that its issue titles and meetings become visible to the target's readers); or the target
is a private conversation whose current people can all see the project (`private.user_can_view_workspace`, checked at
post time, so it follows membership changes). Group-wide meetings, plans and members always post. Issues made by error
tracking (`devdock.via = 'errors'`) and by imports (`import_source`) never post one by one.

**Limits.** At most 60 (webhooks) or 200 (events, errors) messages per feed per clock hour
(`private.chat_feed_windows`). The first message over the limit posts one notice; the rest are counted, and the next hour
starts with "N messages were held back".

## Bot messages

`messages.author_id` is null and `messages.bot` holds `{ feed_id, kind, name, level, icon?, link?, url?, at?, source? }`
(constraint: exactly one of the two). `level` is `info`, `success`, `warning` or `critical`; `link` is an in-app path,
`url` an outside `http(s)` link, `at` a time shown in the reader's time zone (a meeting's start).

- Only the database functions write them, into channels and private group conversations (never DMs). They count as unread like anyone's
  (`conversation_unread_counts` compares `author_id is distinct from` the reader).
- **Critical** ones also notify everyone who can read the target (the group for a channel, the conversation's people for
  a private one) unless they muted it (notification kind `alert`; never emailed).
- People can react, pin and reply in a thread. Nobody can edit them; group owners and admins can delete them.
- The app reads them with `botOf()` (`features/messaging/bot.ts`), and `MessageItem` draws the avatar, name, colour and
  links (`BotParts.tsx`).

## Webhooks (`chat-intake`)

`POST /functions/v1/chat-intake?feed=<id>&token=<token>`. The token is in the URL because AWS SNS and Azure action groups
can't set headers (`x-calsko-token` or `Authorization: Bearer` work too). It's kept only as a SHA-256 hash
(`private.chat_feed_secrets`) and shown once; **New URL** replaces it.

`_shared/chat-feeds/parse.ts` understands, in order:

| Sender | Recognised by | Level |
|---|---|---|
| AWS SNS (CloudWatch alarms or any notification) | `x-amz-sns-message-type` header, or `Type` + `TopicArn` | ALARM critical, OK success, INSUFFICIENT_DATA warning |
| Azure Monitor | `schemaId: azureMonitorCommonAlertSchema` | Sev0–1 critical, Sev2 warning, Sev3–4 info, Resolved success |
| Teams-style card | `@type: MessageCard` | info |
| Slack incoming webhook | `attachments` or `blocks` (or plain `text`) | attachment colour: danger critical, warning, good success |
| Calsko's own | `title` / `text` (or `message`) / `level` / `url` | as given |

SNS subscription confirmations are answered by fetching `SubscribeURL`, only when it's on an `sns.<region>.amazonaws.com`
host. Responses: 200 `{ posted }` (false when over the hourly cap), 400 unreadable, 401 wrong feed or token, feed off, or
flag off.

Tests: `npm run test:feeds`.

## Setup per project

Nothing beyond deploying: the migrations, the `chat-intake` function (`verify_jwt = false` in `supabase/config.toml`) and
`error-sync`. Then switch `chat_feeds` on for a group in the admin console.
