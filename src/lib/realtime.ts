import type { Query, QueryKey } from '@tanstack/react-query'
import { inactivityExpiredNow } from './inactivity'
import { setLiveConnected } from './live'
import { queryClient } from './query-client'
import { supabase } from './supabase'

// Live updates, like Linear: the database tells every open tab when a row
// changes (Supabase Realtime, filtered by RLS), and the queries that show that
// table are refetched. Changes made by other people, other tabs and the GitHub
// webhook all arrive this way. Row data from an event is never shown: at most its
// ids pick which queries to refetch, and its columns are compared with what a list
// already shows to tell whether the list needs asking for again (`rowQueries`).

type Change = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }

const id = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/**
 * A chat message is the busiest change in the app, so it refetches only what it
 * can alter: a new message touches its conversation's timeline and the unread
 * counts, a new reply touches that conversation's threads (replies never count as
 * unread). Edits and deletes can show in either. The conversation list has no
 * column a message changes. Without the row (a hard delete, or one RLS hides) it
 * falls back to every message query.
 */
function messageQueries({ eventType, new: row }: Change): QueryKey[] {
  const conversation = id(row.conversation_id)
  if (!conversation) return [['messaging', 'messages'], ['messaging', 'thread'], ['messaging', 'thread-unread'], ['messaging', 'unread']]
  const team = id(row.team_id)
  const timeline: QueryKey[] = [['messaging', 'messages', conversation], team ? ['messaging', 'unread', team] : ['messaging', 'unread']]
  const threads: QueryKey[] = [['messaging', 'thread', conversation], ['messaging', 'thread-unread', conversation]]
  if (eventType !== 'INSERT') return [...timeline, ...threads]
  return row.parent_id == null ? timeline : threads
}

const startsWith = (key: QueryKey, prefix: QueryKey) => prefix.every((part, i) => key[i] === part)

/** Timestamps arrive formatted differently from the API and from an event; compare the instant. */
const instant = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]/.test(value) ? Date.parse(value) : Number.NaN)

function sameValue(a: unknown, b: unknown) {
  if (a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) return true
  const at = instant(a)
  return !Number.isNaN(at) && at === instant(b)
}

/**
 * True when every cached list already shows this row as it now is, apart from
 * `updated_at` (which is then copied in, re-sorting lists that are newest first).
 * That is the common case by far: saving a doc's text, a whiteboard's canvas or an
 * issue's description changes nothing a list displays. Unknown (not in any cached
 * list, or any shared column differs, e.g. it moved) means the lists must be asked.
 */
function listsAlreadyShow(lists: QueryKey[], row: Record<string, unknown>, newestFirst: boolean): boolean {
  const rowId = id(row.id)
  if (!rowId) return false
  const queries = queryClient.getQueryCache().findAll({ predicate: (query) => lists.some((prefix) => startsWith(query.queryKey, prefix)) })
  let found = false
  for (const query of queries) {
    const data: unknown = query.state.data
    if (!Array.isArray(data)) continue
    const item = (data as Record<string, unknown>[]).find((entry) => entry && entry.id === rowId)
    if (!item) continue
    found = true
    for (const column of Object.keys(item)) {
      if (column !== 'updated_at' && column in row && !sameValue(item[column], row[column])) return false
    }
  }
  if (!found) return false
  for (const query of queries) {
    queryClient.setQueryData<unknown>(query.queryKey, (old: unknown) => {
      if (!Array.isArray(old) || !old.some((entry) => entry?.id === rowId)) return old
      const next = (old as Record<string, unknown>[]).map((entry) => (entry.id === rowId && 'updated_at' in entry ? { ...entry, updated_at: row.updated_at } : entry))
      return newestFirst ? next.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) : next
    })
  }
  return true
}

/**
 * For a table shown both as lists and as one open item (docs, diagrams, issues):
 * an update refetches the open item, and the lists only when they would look different.
 */
function rowQueries(change: Change, lists: QueryKey[], item: (row: Record<string, unknown>) => QueryKey | undefined, all: QueryKey[], newestFirst: boolean): QueryKey[] {
  const row = change.new
  const one = item(row)
  if (!one) return all
  if (change.eventType === 'UPDATE' && listsAlreadyShow(lists, row, newestFirst)) return [one]
  return [...lists, one]
}

const DOC_LISTS: QueryKey[] = [['documents', 'team'], ['documents', 'workspace']]
const DIAGRAM_LISTS: QueryKey[] = [['diagrams', 'team'], ['diagrams', 'workspace']]

function issueQueries(change: Change): QueryKey[] {
  const everything: QueryKey[] = [['issues', 'workspace'], ['issues', 'team'], ['issues', 'detail'], ['issues', 'cycle-history']]
  const workspace = id(change.new.workspace_id)
  const number = change.new.number
  if (!workspace || typeof number !== 'number') return everything
  const lists: QueryKey[] = [['issues', 'workspace', workspace], ['issues', 'team'], ['issues', 'cycle-history', workspace]]
  return rowQueries(change, lists, () => ['issues', 'detail', workspace, number], everything, false)
}

// --- changes this tab made itself ---------------------------------------------
// A save's own echo would refetch what the tab just wrote. The code that saves
// says so here and keeps its own cache right; the echo is then dropped.
//
// `ownSave` is exact: the database stamps every update with `updated_at`, the
// save gets that stamp back, and only the event carrying it is dropped. Anyone
// else's change to the same row has another stamp and always gets through.
//
// `ownWrite` is by time, for rows whose stamp the tab can't know: ones it just
// inserted (matched by their id) and an issue's activity and branches (matched by
// the issue). Someone else's activity on that issue inside the window is dropped
// too, so the mutation must refetch those itself.
const OWN_WRITE_MS = 5000
/** A save that never reports back stops holding its row's events after this long. */
const SAVE_TIMEOUT_MS = 15_000
const STAMP_MS = 60_000
const ownWrites = new Map<string, number>()
const saving = new Map<string, number[]>()
const stamps = new Map<string, number>()

/** `key` is the row's id, or its issue's or conversation's id for the rows that hang off one. */
export function ownWrite(table: string, key: string, ms = OWN_WRITE_MS) {
  ownWrites.set(`${table}:${key}`, Date.now() + ms)
}

/**
 * Call before saving a row; call the returned function when the save settles,
 * with the `updated_at` it got back (nothing if it failed). Events for the row
 * wait in between, so the echo can't slip through before its stamp is known.
 */
export function ownSave(table: string, rowId: string): (updatedAt?: string | null) => void {
  const key = `${table}:${rowId}`
  const started = Date.now()
  saving.set(key, [...(saving.get(key) ?? []), started])
  return (updatedAt) => {
    const left = (saving.get(key) ?? []).filter((at) => at !== started)
    if (left.length > 0) saving.set(key, left)
    else saving.delete(key)
    const at = instant(updatedAt)
    if (!Number.isNaN(at)) stamps.set(`${key}:${at}`, Date.now() + STAMP_MS)
  }
}

const rowOf = (change: Change) => (change.eventType === 'DELETE' ? change.old : change.new)

/** A save of this row is still on its way: its event can't be judged yet. */
function isBeingSaved(table: string, change: Change) {
  const key = `${table}:${id(rowOf(change).id)}`
  const now = Date.now()
  const running = (saving.get(key) ?? []).filter((at) => now - at < SAVE_TIMEOUT_MS)
  if (running.length === 0) saving.delete(key)
  return running.length > 0
}

function isOwnWrite(table: string, change: Change) {
  const now = Date.now()
  for (const [key, until] of ownWrites) if (until < now) ownWrites.delete(key)
  for (const [key, until] of stamps) if (until < now) stamps.delete(key)
  const row = rowOf(change)
  if (stamps.has(`${table}:${id(row.id)}:${instant(row.updated_at)}`)) return true
  return [row.id, row.issue_id, row.conversation_id].some((value) => id(value) !== undefined && ownWrites.has(`${table}:${id(value)}`))
}

/**
 * The query-key prefixes each table shows up in (or a function of the change, for
 * tables busy enough to be worth narrowing). A table must also be in the
 * `supabase_realtime` publication (see the enable_realtime migration) to send events.
 */
/**
 * A file added to a lesson's folder: the lesson page shows it as a tab, so that lesson is asked for
 * again. Only on insert: saving a lesson's text (once a second while typing) mustn't refetch it.
 */
function lessonFileAdded(change: Change): QueryKey[] {
  const lesson = id(change.new.lesson_id)
  return change.eventType === 'INSERT' && lesson ? [['learning', 'lesson', lesson]] : []
}

/** A Brief's text appears in its plan detail and the plans list excerpt. */
function briefPlanQueries(change: Change): QueryKey[] {
  const docId = id(rowOf(change).id)
  if (!docId) return []
  const hasBrief = (row: unknown) =>
    typeof row === 'object' && row !== null && 'brief_id' in row && row.brief_id === docId
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ['plans'] })
    .flatMap((query) => {
      const data = query.state.data
      const rows = Array.isArray(data) ? data : [data]
      return rows.some(hasBrief) ? [query.queryKey] : []
    })
}

const AFFECTS: Record<string, QueryKey[] | ((change: Change) => QueryKey[])> = {
  teams: [['teams']],
  team_members: [['teams'], ['workspaces']],
  workspaces: [['workspaces'], ['issues', 'team']],
  workspace_members: [['workspaces']],
  workspace_collections: [['workspaces']],
  workspace_collection_members: [['workspaces']],
  workspace_modules: [['workspaces']],
  documents: (change) => [
    ...rowQueries(change, DOC_LISTS, (row) => (id(row.id) ? ['documents', id(row.id)] : undefined), [['documents']], true),
    ...lessonFileAdded(change),
    ...briefPlanQueries(change),
  ],
  doc_folders: [['documents', 'folders']],
  diagrams: (change) => [
    ...rowQueries(change, DIAGRAM_LISTS, (row) => (id(row.id) ? ['diagrams', id(row.id)] : undefined), [['diagrams']], true),
    ...lessonFileAdded(change),
  ],
  issues: issueQueries,
  // The group list carries labels, sprints and project repos with each issue (teamIssuesQuery).
  issue_labels: [['issues', 'labels'], ['issues', 'team']],
  issue_label_links: [['issues', 'workspace'], ['issues', 'team'], ['issues', 'detail']],
  issue_comments: [['issues', 'comments']],
  issue_activity: [['issues', 'activity'], ['issues', 'cycle-history']],
  issue_cycles: [['issues', 'cycles'], ['issues', 'team']],
  issue_views: [['issues', 'views'], ['issues', 'pins']],
  issue_pins: [['issues', 'pins']],
  issue_pull_requests: [['issues', 'pull-requests']],
  // Goals assigned to issues (features/plans); a plan's name or status shows in its chips and lists.
  plans: [['plans']],
  // Shared with someone, or unshared: their Files (docs, whiteboards, folders) and the Share dialog.
  file_shares: [['documents'], ['diagrams'], ['file-shares']],
  issue_branches: [['issues', 'branches']],
  repos: [['repos', 'team'], ['repos', 'workspace'], ['issues', 'team']],
  workspace_repos: [['repos', 'team'], ['repos', 'workspace'], ['issues', 'team']],
  learning_modules: [['learning']],
  lessons: [['learning']],
  lesson_progress: [['learning', 'progress']],
  conversations: [['messaging', 'conversations']],
  conversation_members: [['messaging', 'conversations'], ['messaging', 'members'], ['messaging', 'unread']],
  messages: messageQueries,
  message_reactions: [['messaging', 'reactions']],
  message_pins: [['messaging', 'pins']],
  message_attachments: [['messaging', 'attachments']],
  conversation_reads: [['messaging', 'unread']],
  thread_reads: [['messaging', 'thread-unread']],
  conversation_preferences: [['messaging', 'preferences']],
  notifications: [['messaging', 'notifications']],
  chat_feeds: [['messaging', 'feeds']],
  // Only the owner receives these (RLS). The scheduler firing one updates it too (notified_at).
  reminders: [['reminders', 'list']],
}

const BATCH_MS = 250

/** Signed image URLs don't change with the data; refetching them would reload every image. */
const isSignedUrl = (query: Query) => query.queryKey[0] === 'documents' && query.queryKey[1] === 'image'

let channels = 0

/**
 * Asks again for everything on screen, after a stretch in which change events
 * could not arrive. Not when the person has been away past the inactivity limit:
 * a laptop waking in the night is being signed out, not caught up.
 */
export function refreshAfterGap() {
  if (inactivityExpiredNow()) return
  // cancelRefetch off: coming back to a tab also refetches what has gone stale, and those requests shouldn't be sent twice.
  void queryClient.invalidateQueries({ predicate: (query) => !isSignedUrl(query) }, { cancelRefetch: false })
}

/**
 * Subscribes to row changes until the returned function is called. Events are
 * batched, and wait while one of our own saves is running so a refetch can't
 * put an older value over an optimistic one.
 */
export function startRealtimeSync(): () => void {
  // Events wait here until the next flush, so a write this tab reports a moment later still drops its echo.
  const pending: { table: string; change: Change }[] = []
  let timer: number | undefined
  let joined = false

  const flush = () => {
    if (queryClient.isMutating() > 0) {
      timer = window.setTimeout(flush, BATCH_MS)
      return
    }
    timer = undefined
    // Keyed by the serialized prefix, so a burst of events asks for each query once.
    const changed = new Map<string, QueryKey>()
    for (const event of pending.splice(0)) {
      const { table, change } = event
      // Its save hasn't answered yet: look again on the next round.
      if (isBeingSaved(table, change)) {
        pending.push(event)
        continue
      }
      if (isOwnWrite(table, change)) continue
      const affects = AFFECTS[table]
      for (const prefix of typeof affects === 'function' ? affects(change) : (affects ?? [])) changed.set(JSON.stringify(prefix), prefix)
    }
    if (pending.length > 0) timer = window.setTimeout(flush, BATCH_MS)
    const prefixes = [...changed.values()]
    if (prefixes.length === 0) return
    void queryClient.invalidateQueries({
      predicate: (query) => !isSignedUrl(query) && prefixes.some((prefix) => startsWith(query.queryKey, prefix)),
    })
  }

  // A new topic each time: a topic that is still closing can't be subscribed again.
  const channel = supabase
    .channel(`db-changes-${++channels}`)
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      if (!(payload.table in AFFECTS)) return
      pending.push({ table: payload.table, change: payload as Change })
      timer ??= window.setTimeout(flush, BATCH_MS)
    })
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('[realtime] Live updates are not connected', status, error)
      // While disconnected, coming back to the tab refetches as usual (lib/live).
      setLiveConnected(status === 'SUBSCRIBED')
      if (status !== 'SUBSCRIBED') return
      console.info('[realtime] Live updates connected')
      // Back after a dropped connection (sleep, offline): events were missed, so refresh everything.
      if (joined) refreshAfterGap()
      joined = true
    })

  return () => {
    window.clearTimeout(timer)
    setLiveConnected(false)
    void supabase.removeChannel(channel)
  }
}
