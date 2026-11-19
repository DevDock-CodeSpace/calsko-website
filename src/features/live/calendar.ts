import { connectCalendar } from '@/features/auth/api'
import { clearCalendarToken, getCalendarToken } from '@/features/auth/calendar-token'
import { DataError } from '@/lib/errors'
import {
  fetchInvitees,
  fetchSeriesSessions,
  setCalendarEventId,
  setSeriesCalendarEventId,
  type LiveSession,
} from './api'
import { CalendarAuthError, storeReplies, type Reply } from './calendar-shared'
import { eventProvider, idFor, opProvider, providerEventId, type CalendarOp } from './calendar-plan'
import {
  cancelOutlookEvent,
  cancelOutlookOccurrence,
  endOutlookSeries,
  fetchOutlookReplies,
  syncOutlookEvent,
  syncOutlookMeeting,
  syncOutlookSeries,
} from './outlook-calendar'
import { toRdate } from './recurrence'
import { logError } from '@/lib/error-tracking'

// Calendar sync for live sessions, to the organizer's Google Calendar (this
// file) or Outlook (outlook-calendar.ts). The organizer's own calendar holds
// the event; everyone the session is for is an attendee, and the provider
// emails them on create, change and cancel.
//
// Calendar calls need the organizer's token for that provider
// (features/auth/calendar-token). When it's missing or expired, the change is
// queued in sessionStorage, the organizer goes through Google or Microsoft
// once, and useCalendarQueue() finishes the work on the page they come back to.

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const QUEUE_KEY = 'devdock:calendar-queue'

export type { CalendarOp } from './calendar-plan'
export { cancelOps, syncProvider } from './calendar-plan'

async function calendarFetch(token: string, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${EVENTS_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (response.status === 401) {
    clearCalendarToken('google')
    throw new CalendarAuthError('Google Calendar token expired')
  }
  return response
}

function eventBody(session: LiveSession, invitees: string[], url: string, series: LiveSession[] = []) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  // The first meeting is the event itself; the rest are listed as extra dates.
  const rdate = toRdate(series.map((s) => new Date(s.starts_at)), timeZone)
  const description = [session.description?.trim(), `Join in Calsko: ${url}`].filter(Boolean).join('\n\n')
  return {
    summary: session.title,
    description,
    location: url,
    start: { dateTime: session.starts_at, timeZone },
    end: { dateTime: session.ends_at, timeZone },
    attendees: invitees.map((email) => ({ email })),
    source: { title: 'Calsko', url },
    guestsCanInviteOthers: false,
    reminders: { useDefault: true },
    ...(rdate ? { recurrence: [rdate] } : {}),
  }
}

async function syncEvent(token: string, session: LiveSession, url: string): Promise<void> {
  const invitees = await fetchInvitees(session.id)
  const body = JSON.stringify(eventBody(session, invitees, url))
  const existing = idFor('google', session.calendar_event_id)
  if (existing) {
    const response = await calendarFetch(token, `/${encodeURIComponent(existing)}?sendUpdates=all`, {
      method: 'PATCH',
      body,
    })
    if (response.ok) {
      await storeRsvps([session.id], (await response.json()) as GoogleEvent)
      return
    }
    // Deleted in Google Calendar: make a new one below.
    if (response.status !== 404 && response.status !== 410) throw await googleError(response)
  }
  const response = await calendarFetch(token, '?sendUpdates=all', { method: 'POST', body })
  if (!response.ok) throw await googleError(response)
  const event = (await response.json()) as GoogleEvent
  await setCalendarEventId(session.id, event.id)
  await storeRsvps([session.id], event)
}

/** Creates or updates the single recurring event behind a series. */
async function syncSeriesEvent(token: string, seriesId: string, url: string): Promise<void> {
  const series = await fetchSeriesSessions(seriesId)
  const first = series[0]
  // Cancelled in the meantime.
  if (!first) return
  const invitees = await fetchInvitees(first.id)
  const body = JSON.stringify(eventBody(first, invitees, url, series))
  const existing = idFor('google', first.calendar_event_id)
  if (existing) {
    const response = await calendarFetch(token, `/${encodeURIComponent(existing)}?sendUpdates=all`, {
      method: 'PATCH',
      body,
    })
    if (response.ok) {
      await storeRsvps(series.map((s) => s.id), (await response.json()) as GoogleEvent)
      return
    }
    if (response.status !== 404 && response.status !== 410) throw await googleError(response)
  }
  const response = await calendarFetch(token, '?sendUpdates=all', { method: 'POST', body })
  if (!response.ok) throw await googleError(response)
  const event = (await response.json()) as GoogleEvent
  await setSeriesCalendarEventId(seriesId, event.id)
  await storeRsvps(series.map((s) => s.id), event)
}

async function deleteEvent(token: string, eventId: string): Promise<void> {
  const response = await calendarFetch(token, `/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: 'DELETE' })
  // Already gone is fine.
  if (!response.ok && response.status !== 404 && response.status !== 410) throw await googleError(response)
}

type GoogleEvent = { id: string; attendees?: { email?: string; responseStatus?: string; self?: boolean }[] }

/**
 * Mirrors the event's attendee replies into Calsko. The organizer is skipped
 * (they're not an invitee), and only their own token is ever used, so nobody
 * else has to connect a calendar for this to work.
 */
async function storeRsvps(sessionIds: string[], event: GoogleEvent): Promise<void> {
  const known = ['accepted', 'declined', 'tentative', 'needsAction']
  const replies: Reply[] = (event.attendees ?? [])
    .filter((a) => !a.self && a.email)
    .map((a) => ({
      email: a.email as string,
      status: (known.includes(a.responseStatus ?? '') ? a.responseStatus : 'needsAction') as Reply['status'],
    }))
  // Replies belong to every meeting of a series, which share one Google event.
  await storeReplies(sessionIds, replies)
}

/** Reads the event again and refreshes the stored replies. Organizers only. */
export async function refreshRsvps(session: LiveSession): Promise<boolean> {
  const stored = session.calendar_event_id
  if (!stored) return false
  const provider = eventProvider(stored)
  const token = getCalendarToken(provider)
  if (!token) return false
  const id = providerEventId(stored)
  let replies: Reply[] | null
  if (provider === 'outlook') {
    replies = await fetchOutlookReplies(token, id)
  } else {
    const response = await calendarFetch(token, `/${encodeURIComponent(id)}`, { method: 'GET' })
    // Nothing to mirror (deleted in Google, or the token lost its scope).
    if (response.status === 404 || response.status === 410) return false
    if (!response.ok) throw await googleError(response)
    await storeRsvps(await sameEventIds(session), (await response.json()) as GoogleEvent)
    return true
  }
  if (!replies) return false
  await storeReplies(await sameEventIds(session), replies)
  return true
}

/** The meetings that share this session's event: the series for a repeating event, else just this one. */
async function sameEventIds(session: LiveSession): Promise<string[]> {
  if (!session.series_id) return [session.id]
  const series = await fetchSeriesSessions(session.series_id)
  return series.filter((s) => s.calendar_event_id === session.calendar_event_id).map((s) => s.id)
}

async function googleError(response: Response): Promise<DataError> {
  const detail = await response.text().catch(() => '')
  logError('[calendar] Google Calendar API error', response.status, detail)
  const message =
    response.status === 403
      ? 'Google Calendar refused the change. Make sure you allowed Calsko to manage calendar events.'
      : 'Couldn’t update Google Calendar. Please try again.'
  return new DataError(message, String(response.status))
}

// ------------------------------------------------------------------ queue

function readQueue(): CalendarOp[] {
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as CalendarOp[]) : []
  } catch {
    return []
  }
}

function writeQueue(ops: CalendarOp[]) {
  try {
    if (ops.length) sessionStorage.setItem(QUEUE_KEY, JSON.stringify(ops))
    else sessionStorage.removeItem(QUEUE_KEY)
  } catch {
    // Storage blocked: queued changes are lost; the session page offers a manual sync.
  }
}

export function hasQueuedCalendarOps(): boolean {
  return readQueue().length > 0
}

async function runOp(token: string, op: CalendarOp, load: (id: string) => Promise<LiveSession | null>) {
  const outlook = opProvider(op) === 'outlook'
  switch (op.kind) {
    case 'delete': {
      const id = providerEventId(op.eventId)
      return outlook ? cancelOutlookEvent(token, id) : deleteEvent(token, id)
    }
    case 'delete_occurrence':
      return cancelOutlookOccurrence(token, providerEventId(op.eventId), op.startsAt, op.endsAt)
    case 'end_series':
      return endOutlookSeries(token, providerEventId(op.eventId), op.lastStartsAt)
    case 'sync_series':
      return outlook ? syncOutlookSeries(token, op.seriesId, op.url) : syncSeriesEvent(token, op.seriesId, op.url)
    case 'sync_meeting': {
      // Google: the series is one event listing every date, so it's re-synced as a whole.
      if (!outlook) return syncSeriesEvent(token, op.seriesId, op.url)
      const session = await load(op.sessionId)
      return session ? syncOutlookMeeting(token, session, op.before, op.url) : undefined
    }
    case 'sync': {
      const session = await load(op.sessionId)
      // Cancelled in the meantime: nothing to sync.
      if (!session) return
      return outlook ? syncOutlookEvent(token, session, op.url) : syncEvent(token, session, op.url)
    }
  }
}

export type CalendarResult = 'done' | 'redirecting'

/**
 * Runs calendar changes now when there's a token for their calendar, otherwise
 * queues them and sends the organizer to Google or Microsoft (resolves
 * 'redirecting' as the page leaves). `returnTo` is where they come back to;
 * that page runs useCalendarQueue().
 */
export async function runCalendarOps(
  ops: CalendarOp[],
  options: {
    load: (sessionId: string) => Promise<LiveSession | null>
    returnTo: string
    email: string | undefined
  },
): Promise<CalendarResult> {
  for (const [i, op] of ops.entries()) {
    const provider = opProvider(op)
    const token = getCalendarToken(provider)
    if (token) {
      try {
        await runOp(token, op, options.load)
        continue
      } catch (error) {
        if (!(error instanceof CalendarAuthError)) throw error
        // Expired mid-way: fall through and reconnect (ops are idempotent).
      }
    }
    writeQueue([...readQueue(), ...ops.slice(i)])
    await connectCalendar(provider, options.returnTo, options.email)
    return 'redirecting'
  }
  return 'done'
}

/**
 * After coming back from Google or Microsoft: runs the queued changes that
 * have a token. Returns how many ran, or null when none could (the queue is
 * kept for later).
 */
export async function flushCalendarQueue(load: (sessionId: string) => Promise<LiveSession | null>) {
  const ops = readQueue()
  if (ops.length === 0) return null
  const ready = ops.filter((op) => getCalendarToken(opProvider(op)))
  if (ready.length === 0) return null
  const kept: CalendarOp[] = ops.filter((op) => !ready.includes(op))
  writeQueue(kept)
  let firstError: unknown
  for (const op of ready) {
    try {
      await runOp(getCalendarToken(opProvider(op)) as string, op, load)
    } catch (error) {
      kept.push(op)
      firstError ??= error
    }
  }
  writeQueue(kept)
  if (firstError) {
    throw firstError instanceof CalendarAuthError ? new DataError('Calendar sign-in expired. Try again.') : firstError
  }
  return ready.length
}
