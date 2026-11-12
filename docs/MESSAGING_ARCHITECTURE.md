# Chat (messaging) architecture

Decision record for group chat, first written 2026-10-03. The UI says **Chat**; code (`features/messaging/`), tables and the
route (`…/messages`) say messages. The everyday rules for the code are in CLAUDE.md (Messaging).

## Scope

Chat is group-scoped: channels (`#general` is created automatically), DMs and ad-hoc groups. No private channels and no
cross-group conversations. It does not reuse workspace visibility.

## Tables

- `conversations`: `team_id`, `kind` (`channel`/`dm`/`group`), name, description, archived. One `general` channel per group.
- `conversation_members`: membership, role (`owner`/`member`), joined/left. **The only authority for DMs and groups**;
  group admins don't bypass it.
- `messages`: author (null for a bot's message, which has `bot` instead), optional `parent_id` (one level of threads), `client_id` (retry idempotency), TipTap JSON `body`, a
  plain-text `content` copy, edited/deleted stamps. A deleted message stays as a placeholder.
- `message_reactions`, `message_pins`, `message_attachments` (private 10 MB bucket, allow-listed types), `conversation_reads`,
  `thread_reads`, `conversation_preferences` (all / mentions / muted), `notifications` (recipient-only, unique dedupe key).

## Authorization

- Channels: readable by everyone currently in the group, history included. DMs and groups: current members only.
- Every membership write checks both people are in the same group. Removing someone from a group (or a group conversation)
  removes their access through the membership check at once.
- Authors edit and delete only their own messages (`edit_message`/`delete_message` RPCs); reactions are self-owned.
- Channel create/rename/archive: group owners and admins. `#general` can't be archived.
- Every table has explicit grants and RLS; multi-row writes go through RPCs that re-check access.

## Message format and sending

- Constrained TipTap schema: paragraphs, bold, italic, lists, inline code, code blocks, `http`/`https`/`mailto` links.
  The server checks only that the body is a JSON object, so `MessageBody` must tolerate anything.
- History is the newest N rows ordered by `(created_at, id)`; "Load earlier" raises N so refetches never leave gaps.
- `send_message` validates the parent, inserts, and writes mention/DM notifications in one transaction;
  `(conversation_id, author_id, client_id)` is unique, so a retry returns the existing message.

## Threads, unread, notifications

One level of threads. Unread state comes from read positions (`mark_conversation_read`, `mark_thread_read`). DMs, groups,
mentions and thread replies notify; muting suppresses alerts but not unread counts. Typing is Realtime Presence, never stored.

## Bot messages
Chat feeds (`docs/CHAT_FEEDS.md`) post into channels and private group conversations as bots: `author_id` is null and `bot` says who posted. Only database
functions write them; group owners and admins can delete them; critical ones notify the group (`alert`).

## Search
A parameterized RPC over an indexed text projection: only conversations the caller can read, no deleted bodies, replies
included. Never a client-side download.

## Not built
Instant calls from a conversation: needs a `conversation_calls` record and a `jaas-token` change that re-checks current
membership on every token. Polls, meeting cards and link previews are also not built.
