import { clearCalendarToken } from '@/features/auth/calendar-token'
import { DataError } from '@/lib/errors'
import { logError } from '@/lib/error-tracking'
import { fetchInvitees, fetchSeriesSessions, setCalendarEventId, setSeriesCalendarEventId, type LiveSession } from './api'
import { CalendarAuthError, storeReplies, type Reply } from './calendar-shared'
import { idFor, storedEventId } from './calendar-plan'
import { inferPattern } from './recurrence'

// Outlook sync for live sessions, through Microsoft Graph. Works like the
// Google sync (calendar.ts): the organizer's own calendar holds the event,
// everyone the session is for is an attendee, and Outlook emails them on
// create, change and cancel.
//
// A series that follows a pattern (daily, or weekly on set days) is one
// repeating event. Outlook can't hold a list of hand-picked dates the way
// Google's RDATE does, so an irregular series gets one event per meeting.
// A series keeps the shape it was created with: editing or cancelling one
// meeting changes just that occurrence, so nobody gets the whole series again.

const EVENTS_URL = 'https://graph.microsoft.com/v1.0/me/events'
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

async function graphFetch(token: string, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${EVENTS_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (response.status === 401) {
    clearCalendarToken('outlook')
    throw new CalendarAuthError('Outlook token expired')
  }
  return response
}

const gone = (response: Response) => response.status === 404 || response.status === 410

async function outlookError(response: Response): Promise<DataError> {
  const detail = await response.text().catch(() => '')
  logError('[calendar] Microsoft Graph error', response.status, detail)
  let code = ''
  try {
    code = (JSON.parse(detail) as { error?: { code?: string } }).error?.code ?? ''
  } catch {
    // Not JSON: the status decides.
  }
  const message =
    code === 'MailboxNotEnabledForRESTAPI' || code === 'ResourceNotFound'
      ? 'This Microsoft account has no Outlook calendar. Sign in with an account that has one, or use Google Calendar.'
      : response.status === 403
        ? 'Outlook refused the change. Make sure you allowed Calsko to manage your calendar.'
        : 'Couldn’t update Outlook. Please try again.'
  return new DataError(message, String(response.status))
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Local wall-clock time, which Graph pairs with a time zone name. */
const localStamp = (d: Date) => `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`

type Recurrence = {
  pattern: { type: 'daily'; interval: 1 } | { type: 'weekly'; interval: 1; daysOfWeek: string[]; firstDayOfWeek: 'sunday' }
  range:
    | { type: 'numbered'; startDate: string; numberOfOccurrences: number; recurrenceTimeZone: string }
    | { type: 'endDate'; startDate: string; endDate: string; recurrenceTimeZone: string }
}

/** The repeat rule for a series, or null when its dates follow no pattern. */
function recurrenceFor(series: LiveSession[], timeZone: string): Recurrence | null {
  const starts = series.map((s) => new Date(s.starts_at))
  const pattern = inferPattern(starts)
  if (!pattern) return null
  return {
    pattern:
      pattern.freq === 'daily'
        ? { type: 'daily', interval: 1 }
        : { type: 'weekly', interval: 1, daysOfWeek: pattern.days.map((d) => WEEKDAYS[d]), firstDayOfWeek: 'sunday' },
    range: {
      type: 'numbered',
      startDate: dateKey(starts[0]),
      numberOfOccurrences: starts.length,
      recurrenceTimeZone: timeZone,
    },
  }
}

function eventBody(session: LiveSession, invitees: string[], url: string, recurrence?: Recurrence) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const content = [session.description?.trim(), `Join in Calsko: ${url}`].filter(Boolean).join('\n\n')
  return {
    subject: session.title,
    body: { contentType: 'text', content },
    start: { dateTime: localStamp(new Date(session.starts_at)), timeZone },
    end: { dateTime: localStamp(new Date(session.ends_at)), timeZone },
    location: { displayName: url, locationUri: url },
    attendees: invitees.map((address) => ({ emailAddress: { address }, type: 'required' })),
    allowNewTimeProposals: false,
    ...(recurrence ? { recurrence } : {}),
  }
}

type GraphEvent = {
  id: string
  attendees?: { emailAddress?: { address?: string }; status?: { response?: string } }[]
}

function replies(event: GraphEvent): Reply[] {
  const status = (response: string | undefined): Reply['status'] =>
    response === 'accepted'
      ? 'accepted'
      : response === 'declined'
        ? 'declined'
        : response === 'tentativelyAccepted'
          ? 'tentative'
          : 'needsAction'
  return (event.attendees ?? [])
    .filter((a) => a.emailAddress?.address && a.status?.response !== 'organizer')
    .map((a) => ({ email: a.emailAddress?.address as string, status: status(a.status?.response) }))
}

/** PATCHes the event; returns null when it was deleted in Outlook (make a new one). */
async function patchEvent(token: string, id: string, body: object): Promise<GraphEvent | null> {
  const response = await graphFetch(token, `/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) })
  if (response.ok) return (await response.json()) as GraphEvent
  if (gone(response)) return null
  throw await outlookError(response)
}

async function createEvent(token: string, body: object): Promise<GraphEvent> {
  const response = await graphFetch(token, '', { method: 'POST', body: JSON.stringify(body) })
  if (!response.ok) throw await outlookError(response)
  return (await response.json()) as GraphEvent
}

/** Creates or updates one meeting's own event. `existing` is its Outlook id, if any. */
async function syncOne(token: string, session: LiveSession, existing: string | null, url: string, invitees: string[]) {
  const body = eventBody(session, invitees, url)
  const updated = existing ? await patchEvent(token, existing, body) : null
  if (updated) return storeReplies([session.id], replies(updated))
  const created = await createEvent(token, body)
  await setCalendarEventId(session.id, storedEventId('outlook', created.id))
  await storeReplies([session.id], replies(created))
}

export async function syncOutlookEvent(token: string, session: LiveSession, url: string): Promise<void> {
  const invitees = await fetchInvitees(session.id)
  await syncOne(token, session, idFor('outlook', session.calendar_event_id), url, invitees)
}

/**
 * Creates or updates a series: one repeating event when the dates follow a
 * pattern, else one event per meeting. An existing repeating event stays one
 * (when a moved meeting broke the pattern, its occurrence was already changed
 * on its own, so only the details are updated here).
 */
export async function syncOutlookSeries(token: string, seriesId: string, url: string): Promise<void> {
  const series = await fetchSeriesSessions(seriesId)
  const first = series[0]
  // Cancelled in the meantime.
  if (!first) return
  const invitees = await fetchInvitees(first.id)
  const ids = series.map((s) => idFor('outlook', s.calendar_event_id))
  // Every meeting holds the same id: that's one repeating event.
  const shared = series.length > 1 && ids[0] && ids.every((id) => id === ids[0]) ? ids[0] : null
  const recurrence = recurrenceFor(series, Intl.DateTimeFormat().resolvedOptions().timeZone)
  const allIds = series.map((s) => s.id)

  if (shared) {
    const full = eventBody(first, invitees, url, recurrence ?? undefined)
    // No pattern any more: leave the times and occurrences as they are, update the rest.
    const body = recurrence ? full : { ...full, start: undefined, end: undefined }
    const updated = await patchEvent(token, shared, body)
    if (updated) return storeReplies(allIds, replies(updated))
  }

  // Nothing in Outlook yet (or the repeating event was deleted there): one repeating event if it fits.
  if (recurrence && ids.every((id) => !id || id === shared)) {
    const created = await createEvent(token, eventBody(first, invitees, url, recurrence))
    await setSeriesCalendarEventId(seriesId, storedEventId('outlook', created.id))
    return storeReplies(allIds, replies(created))
  }

  for (const [i, session] of series.entries()) {
    await syncOne(token, session, ids[i] === shared ? null : ids[i], url, invitees)
  }
}

/**
 * One meeting of a series was edited. A repeating event changes just that
 * occurrence (found at its old time); a meeting with its own event updates it.
 */
export async function syncOutlookMeeting(
  token: string,
  session: LiveSession,
  before: { startsAt: string; endsAt: string },
  url: string,
): Promise<void> {
  const id = idFor('outlook', session.calendar_event_id)
  const series = session.series_id ? await fetchSeriesSessions(session.series_id) : []
  const shared = id !== null && series.filter((s) => s.calendar_event_id === session.calendar_event_id).length > 1
  if (!shared) return syncOutlookEvent(token, session, url)
  const occurrences = await findOccurrences(token, id, before.startsAt, before.endsAt)
  // Attendees belong to the whole series; an occurrence takes the rest.
  const { attendees: _attendees, ...body } = eventBody(session, [], url)
  for (const occurrence of occurrences) await patchEvent(token, occurrence, body)
}

/** The ids of a repeating event's occurrences around this time (normally one). */
async function findOccurrences(token: string, seriesId: string, startsAt: string, endsAt: string): Promise<string[]> {
  const range = new URLSearchParams({
    startDateTime: new Date(Date.parse(startsAt) - 60_000).toISOString(),
    endDateTime: new Date(Date.parse(endsAt) + 60_000).toISOString(),
    $select: 'id',
  })
  const response = await graphFetch(token, `/${encodeURIComponent(seriesId)}/instances?${range}`, { method: 'GET' })
  if (gone(response)) return []
  if (!response.ok) throw await outlookError(response)
  const { value } = (await response.json()) as { value: { id: string }[] }
  return value.map((occurrence) => occurrence.id)
}

/** Ends a repeating event on the day of `lastStartsAt` (later meetings were cancelled). */
export async function endOutlookSeries(token: string, id: string, lastStartsAt: string): Promise<void> {
  const response = await graphFetch(token, `/${encodeURIComponent(id)}?$select=recurrence`, { method: 'GET' })
  if (gone(response)) return
  if (!response.ok) throw await outlookError(response)
  const { recurrence } = (await response.json()) as { recurrence: Recurrence | null }
  if (!recurrence) return
  const range = {
    type: 'endDate',
    startDate: recurrence.range.startDate,
    endDate: dateKey(new Date(lastStartsAt)),
    recurrenceTimeZone: recurrence.range.recurrenceTimeZone,
  }
  await patchEvent(token, id, { recurrence: { ...recurrence, range } })
}

/** Cancels the event (attendees are told), or deletes it when it has nobody to tell. */
export async function cancelOutlookEvent(token: string, id: string): Promise<void> {
  const cancel = await graphFetch(token, `/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' })
  if (cancel.ok || gone(cancel)) return
  // Graph refuses to cancel an event without attendees; deleting it is the same.
  const response = await graphFetch(token, `/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok && !gone(response)) throw await outlookError(response)
}

/** Cancels one meeting of a repeating event, leaving the others. */
export async function cancelOutlookOccurrence(token: string, seriesId: string, startsAt: string, endsAt: string) {
  for (const occurrence of await findOccurrences(token, seriesId, startsAt, endsAt)) {
    await cancelOutlookEvent(token, occurrence)
  }
}

/** Reads the event's attendee replies; null when it no longer exists. */
export async function fetchOutlookReplies(token: string, id: string): Promise<Reply[] | null> {
  const response = await graphFetch(token, `/${encodeURIComponent(id)}?$select=attendees`, { method: 'GET' })
  if (gone(response)) return null
  if (!response.ok) throw await outlookError(response)
  return replies((await response.json()) as GraphEvent)
}
