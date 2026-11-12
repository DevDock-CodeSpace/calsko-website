import { FunctionsHttpError } from '@supabase/supabase-js'
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query'
import type { PersonProfile } from '@/features/teams/api'
import type { WorkspaceType } from '@/features/workspaces/api'
import { DataError, requireAffected, toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { logError } from '@/lib/error-tracking'

// Meetings (live_sessions): scheduled Jitsi (JaaS) calls. Same scope model and access
// rules as docs (workspace_id null = group-wide): readers see and join, writers
// (group owners/admins, workspace leads) schedule, edit and cancel; Developers
// in Development Spaces can schedule meetings in their Space.
// The room itself is only reachable with a token from the jaas-token Edge Function.

/** Google's reply states; 'needsAction' is "invited, hasn't replied". */
export type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'

const RSVP_STATUSES: RsvpStatus[] = ['accepted', 'declined', 'tentative', 'needsAction']

/** The database constrains this, but narrow it here rather than trust the column's `string`. */
const toRsvpStatus = (value: string): RsvpStatus =>
  (RSVP_STATUSES as string[]).includes(value) ? (value as RsvpStatus) : 'needsAction'

export type Rsvp = {
  user_id: string
  status: RsvpStatus
  updated_at: string
  profile: PersonProfile | null
}

export type LiveSession = {
  id: string
  team_id: string
  workspace_id: string | null
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  calendar_event_id: string | null
  /** Shared by every meeting of a repeating series; null for one-off meetings. */
  series_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  author: PersonProfile | null
  workspace: { id: string; title: string; type: WorkspaceType } | null
}

/** Replies, for the single-meeting query only; lists don't need them. */
const RSVP_COLUMNS = ', rsvps:live_session_rsvps(user_id, status, updated_at, profile:profiles(display_name, avatar_url))'

// room_name is left out: the browser only gets it with a JaaS token.
const COLUMNS =
  'id, team_id, workspace_id, title, description, starts_at, ends_at, calendar_event_id, series_id, created_by, created_at, updated_at, author:profiles!live_sessions_created_by_fkey(display_name, avatar_url), workspace:workspaces!live_sessions_workspace_team_fkey(id, title, type)'

/** The single-meeting select: the same columns plus the embedded replies. */
const SESSION_COLUMNS = `${COLUMNS}${RSVP_COLUMNS}`

const writeErrors = {
  '42501': 'You don’t have permission to schedule meetings here.',
  '23514': 'Check the times: a meeting ends after it starts and lasts at most 12 hours.',
}

// ---------------------------------------------------------------- queries

/** Every meeting in the group the caller can see (the message attachment picker; the Meetings page pages instead). */
export const teamLiveSessionsQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['live', 'team', teamId],
    queryFn: async (): Promise<LiveSession[]> => {
      const { data, error } = await supabase
        .from('live_sessions')
        .select(COLUMNS)
        .eq('team_id', teamId)
        .order('starts_at', { ascending: true })
      if (error) throw toDataError('load meetings', error)
      return data
    },
  })

// ---------------------------------------------------------------- paged lists (the Meetings page)

/** Meetings fetched per request as the list scrolls. */
export const MEETINGS_PAGE = 10

/**
 * Whose meetings a list shows. In a group: `workspaceIds` narrows to the collection in
 * view (group-wide meetings always belong); null shows everything the caller can see.
 */
export type MeetingsScope =
  | { kind: 'team'; teamId: string; workspaceIds: string[] | null }
  | { kind: 'workspace'; workspaceId: string }

export type MeetingsPage = { rows: LiveSession[]; total: number; next: number | undefined }

const scopeKey = (scope: MeetingsScope) =>
  scope.kind === 'team' ? ['team', scope.teamId, scope.workspaceIds?.join(',') ?? 'all'] : ['workspace', scope.workspaceId]

function scoped<Q extends { eq: (column: string, value: string) => Q; or: (filters: string) => Q }>(query: Q, scope: MeetingsScope): Q {
  if (scope.kind === 'workspace') return query.eq('workspace_id', scope.workspaceId)
  const team = query.eq('team_id', scope.teamId)
  if (!scope.workspaceIds) return team
  // Ids come from the cache (uuids), never from what someone typed.
  return scope.workspaceIds.length === 0
    ? team.or('workspace_id.is.null')
    : team.or(`workspace_id.is.null,workspace_id.in.(${scope.workspaceIds.join(',')})`)
}

/**
 * One section of the Meetings list, MEETINGS_PAGE at a time: `upcoming` (live and not yet
 * ended, soonest first) or `past` (ended, latest first). The first page also carries the
 * section's total. "Now" is read when each page is fetched, so the key doesn't tick.
 */
export const meetingsPageQuery = (scope: MeetingsScope, when: 'upcoming' | 'past') =>
  infiniteQueryOptions({
    queryKey: ['live', 'list', ...scopeKey(scope), when],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<MeetingsPage> => {
      const now = new Date().toISOString()
      const query = scoped(supabase.from('live_sessions').select(COLUMNS, { count: 'exact' }), scope)
      const { data, error, count } = await (when === 'upcoming'
        ? query.gt('ends_at', now).order('starts_at', { ascending: true })
        : query.lte('ends_at', now).order('starts_at', { ascending: false })
      ).range(pageParam, pageParam + MEETINGS_PAGE - 1)
      if (error) throw toDataError('load meetings', error)
      const total = count ?? data.length
      const after = pageParam + data.length
      return { rows: data, total, next: data.length === MEETINGS_PAGE && after < total ? after : undefined }
    },
    getNextPageParam: (last) => last.next,
  })

/** The Meetings calendar: only what overlaps the visible month or week. */
export const meetingsRangeQuery = (scope: MeetingsScope, from: Date, to: Date) =>
  queryOptions({
    queryKey: ['live', 'range', ...scopeKey(scope), from.toISOString(), to.toISOString()],
    queryFn: async (): Promise<LiveSession[]> => {
      const { data, error } = await scoped(supabase.from('live_sessions').select(COLUMNS), scope)
        .lt('starts_at', to.toISOString())
        .gt('ends_at', from.toISOString())
        .order('starts_at', { ascending: true })
        // A month holds a few dozen at most; the cap keeps a runaway series from loading everything.
        .limit(500)
      if (error) throw toDataError('load meetings', error)
      return data
    },
    // Moving to the next month shows this one until the new one arrives.
    placeholderData: keepPreviousData,
  })

/** null when the session doesn't exist or the caller can't see it. */
export const liveSessionQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ['live', sessionId],
    queryFn: async (): Promise<(LiveSession & { rsvps: Rsvp[] }) | null> => {
      // One query: the replies come back embedded, so the page makes no extra round trip.
      const { data, error } = await supabase
        .from('live_sessions')
        .select(SESSION_COLUMNS)
        .eq('id', sessionId)
        .maybeSingle()
      if (error) throw toDataError('load the meeting', error)
      return data && { ...data, rsvps: data.rsvps.map((r) => ({ ...r, status: toRsvpStatus(r.status) })) }
    },
  })

/** All meetings of a series, soonest first (for the calendar event and the series summary). */
export async function fetchSeriesSessions(seriesId: string): Promise<LiveSession[]> {
  const { data, error } = await supabase
    .from('live_sessions')
    .select(COLUMNS)
    .eq('series_id', seriesId)
    .order('starts_at', { ascending: true })
  if (error) throw toDataError('load the series', error)
  return data
}

export const seriesSessionsQuery = (seriesId: string) =>
  queryOptions({ queryKey: ['live', 'series', seriesId], queryFn: () => fetchSeriesSessions(seriesId) })

// -------------------------------------------------------------- mutations

export type LiveSessionInput = {
  title: string
  description: string
  startsAt: string
  endsAt: string
}

/** created_by and room_name are set by the database; the scope can't change later. */
export async function createLiveSession(
  input: LiveSessionInput & { teamId: string; workspaceId: string | null },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('live_sessions')
    .insert({
      team_id: input.teamId,
      workspace_id: input.workspaceId,
      title: input.title.trim(),
      description: input.description.trim() || null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    })
    .select('id')
    .single()
  if (error) throw toDataError('schedule the meeting', error, writeErrors)
  return data
}

/** One database call creates the whole series. Returns the new meetings, soonest first. */
export async function createLiveSeries(
  input: Omit<LiveSessionInput, 'startsAt' | 'endsAt'> & {
    teamId: string
    workspaceId: string | null
    starts: Date[]
    durationMinutes: number
  },
): Promise<{ id: string; seriesId: string | null; startsAt: string }[]> {
  const { data, error } = await supabase.rpc('create_live_series', {
    p_team_id: input.teamId,
    // The generated type says string; the function takes null for group-wide meetings.
    p_workspace_id: input.workspaceId as string,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_starts: input.starts.map((d) => d.toISOString()),
    p_duration_minutes: input.durationMinutes,
  })
  if (error) throw toDataError('schedule the meetings', error, writeErrors)
  return data
    .map((row) => ({ id: row.id, seriesId: row.series_id, startsAt: row.starts_at }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
}

export async function updateLiveSession(sessionId: string, input: LiveSessionInput) {
  const { data, error } = await supabase
    .from('live_sessions')
    .update({
      title: input.title.trim(),
      description: input.description.trim() || null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    })
    .eq('id', sessionId)
    .select('id')
  if (error) throw toDataError('save the meeting', error, writeErrors)
  requireAffected(data, 'update live session')
}

export async function setCalendarEventId(sessionId: string, eventId: string | null) {
  const { data, error } = await supabase
    .from('live_sessions')
    .update({ calendar_event_id: eventId })
    .eq('id', sessionId)
    .select('id')
  if (error) throw toDataError('save the calendar event', error, writeErrors)
  requireAffected(data, 'set calendar event id')
}

/** Every meeting of the series gets the same Google Calendar event. */
export async function setSeriesCalendarEventId(seriesId: string, eventId: string | null) {
  const { data, error } = await supabase
    .from('live_sessions')
    .update({ calendar_event_id: eventId })
    .eq('series_id', seriesId)
    .select('id')
  if (error) throw toDataError('save the calendar event', error, writeErrors)
  requireAffected(data, 'set series calendar event id')
}

/** Cancels this meeting and every later one in its series (not the ones already held). */
export async function deleteLiveSeriesFrom(seriesId: string, fromStartsAt: string) {
  const { data, error } = await supabase
    .from('live_sessions')
    .delete()
    .eq('series_id', seriesId)
    .gte('starts_at', fromStartsAt)
    .select('id')
  if (error) throw toDataError('cancel the meetings', error, writeErrors)
  requireAffected(data, 'delete live series')
}

export async function deleteLiveSession(sessionId: string) {
  const { data, error } = await supabase.from('live_sessions').delete().eq('id', sessionId).select('id')
  if (error) throw toDataError('cancel the meeting', error, writeErrors)
  requireAffected(data, 'delete live session')
}

/**
 * Stores who replied to the invite. Emails go in, only profile ids are kept
 * (the function resolves them), so no address is ever written to a readable table.
 */
export async function saveRsvps(sessionId: string, responses: { email: string; status: string }[]) {
  const { error } = await supabase.rpc('set_live_session_rsvps', {
    p_session_id: sessionId,
    p_responses: responses,
  })
  if (error) throw toDataError('save the replies', error)
}

/** Emails of everyone the session is for (group or workspace), minus the caller. Writers only. */
export async function fetchInvitees(sessionId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('live_session_invitees', { p_session_id: sessionId })
  if (error) throw toDataError('load the invite list', error)
  return data.map((row) => row.email)
}

// ------------------------------------------------------------------ JaaS

export type JaasToken = { token: string; appId: string; roomName: string }

const tokenErrors: Record<string, string> = {
  not_configured: 'Live video isn’t set up yet. The group owner needs to add the JaaS keys.',
  too_early: 'This meeting opens 15 minutes before it starts.',
  ended: 'This meeting has ended.',
  not_found: 'This meeting doesn’t exist anymore, or you don’t have access to it.',
  unauthorized: 'Your session expired. Sign in again to join.',
}

/** A short-lived JaaS token for this session (the Edge Function checks access). */
export async function fetchJaasToken(sessionId: string): Promise<JaasToken> {
  const { data, error } = await supabase.functions.invoke<JaasToken>('jaas-token', { body: { sessionId } })
  if (error || !data) {
    let code: string | undefined
    if (error instanceof FunctionsHttpError) {
      code = await (error.context as Response)
        .json()
        .then((body: { error?: string }) => body.error)
        .catch(() => undefined)
    }
    logError('[live] jaas-token failed', code ?? error)
    throw new DataError((code && tokenErrors[code]) ?? 'Couldn’t join the call. Please try again.', code, {
      cause: error,
    })
  }
  return data
}
