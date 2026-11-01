// Whether live updates (lib/realtime) are currently keeping a query fresh. When
// they are, coming back to the tab doesn't need to ask for the data again: every
// change already arrived as an event, and a dropped connection refetches
// everything when it returns. Kept apart from realtime.ts so the query client can
// read it without importing the Supabase client.

let connected = false

export function setLiveConnected(value: boolean) {
  connected = value
}

/** Roots whose tables are all in the `supabase_realtime` publication (see AFFECTS in realtime.ts). */
const LIVE_ROOTS = new Set(['teams', 'workspaces', 'documents', 'diagrams', 'issues', 'repos', 'learning', 'messaging', 'reminders', 'plans'])

/** Queries under those roots that no event refreshes: tables left out of the publication, GitHub, signed URLs, search. */
const NOT_LIVE: ((key: readonly unknown[]) => boolean)[] = [
  (key) => key[0] === 'teams' && key.includes('invites'),
  (key) => key[0] === 'repos' && (key[1] === 'installations' || key[1] === 'github' || key[1] === 'branches'),
  (key) => key[0] === 'documents' && key[1] === 'image',
  (key) => key[0] === 'messaging' && (key[1] === 'search' || key[1] === 'image-urls'),
  // Reads issues, whose events don't reach this key.
  (key) => key[0] === 'reminders' && key[1] === 'issue-options',
  // A plan's page carries its Brief's text; doc events don't reach this key.
  (key) => key[0] === 'plans' && key[1] === 'detail',
  // The Learning page's numbers come from several tables in one call, and course_codes isn't published.
  (key) => key[0] === 'learning' && (key[1] === 'overview' || key[1] === 'codes'),
  // issue_import_people isn't published.
  (key) => key[0] === 'issues' && key[1] === 'import-people',
  // Issue titles in Starred: issue events refresh lists and the open issue, not this.
  (key) => key[0] === 'issues' && key[1] === 'pins' && key[2] === 'issues',
]

export function keptLive(key: readonly unknown[]): boolean {
  return connected && typeof key[0] === 'string' && LIVE_ROOTS.has(key[0]) && !NOT_LIVE.some((test) => test(key))
}
