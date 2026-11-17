// What to change in the organizer's calendar, decided without touching it.
// No imports on purpose: tests/calendar-plan.test.ts runs this in Deno.
//
// live_sessions.calendar_event_id holds the organizer's calendar event. Google
// ids are stored as they are (that's all there was at first); Outlook ids get
// an "outlook:" prefix, so the provider travels with the id and no column or
// migration is needed. Every meeting of a series that is one repeating event
// holds the same id; otherwise each meeting holds its own.

/** Same as CalendarProvider in features/auth/calendar-token (kept here so this file has no imports). */
type Provider = 'google' | 'outlook'

const OUTLOOK_PREFIX = 'outlook:'

export function eventProvider(eventId: string): Provider {
  return eventId.startsWith(OUTLOOK_PREFIX) ? 'outlook' : 'google'
}

/** The id the provider's API knows, without our prefix. */
export function providerEventId(eventId: string): string {
  return eventId.startsWith(OUTLOOK_PREFIX) ? eventId.slice(OUTLOOK_PREFIX.length) : eventId
}

/** The stored id for a provider's event id. */
export function storedEventId(provider: Provider, id: string): string {
  return provider === 'outlook' ? `${OUTLOOK_PREFIX}${id}` : id
}

/** The provider's event id when `eventId` belongs to `provider`, else null. */
export function idFor(provider: Provider, eventId: string | null): string | null {
  return eventId && eventProvider(eventId) === provider ? providerEventId(eventId) : null
}

export type CalendarOp =
  /** Create the event, or update it when the session already has one. */
  | { kind: 'sync'; sessionId: string; url: string; provider?: Provider }
  /** The events for a whole series (Google: one event every meeting shares). */
  | { kind: 'sync_series'; seriesId: string; url: string; provider?: Provider }
  /** One meeting of a series was edited; `before` is its time until now. */
  | {
      kind: 'sync_meeting'
      sessionId: string
      seriesId: string
      url: string
      provider?: Provider
      before: { startsAt: string; endsAt: string }
    }
  /** Cancel an event whose session was deleted (stored id, provider prefix included). */
  | { kind: 'delete'; eventId: string }
  /** Cancel one meeting of an Outlook repeating event. */
  | { kind: 'delete_occurrence'; eventId: string; startsAt: string; endsAt: string }
  /** End an Outlook repeating event with the meeting at `lastStartsAt`. */
  | { kind: 'end_series'; eventId: string; lastStartsAt: string }

/** Which calendar an op talks to. Ops queued before Outlook existed have no provider: Google. */
export function opProvider(op: CalendarOp): Provider {
  if (op.kind === 'delete' || op.kind === 'delete_occurrence' || op.kind === 'end_series') {
    return eventProvider(op.eventId)
  }
  return op.provider ?? 'google'
}

type PlanSession = {
  id: string
  series_id: string | null
  starts_at: string
  ends_at: string
  calendar_event_id: string | null
}

/** The calendar a session syncs to: the one already holding its event, else the organizer's choice. */
export function syncProvider(session: PlanSession | undefined, preferred: Provider): Provider {
  return session?.calendar_event_id ? eventProvider(session.calendar_event_id) : preferred
}

/**
 * The calendar changes after cancelling `session` (and, with `rest`, every
 * later meeting of its series). `series` is the series as it was before.
 * Each attendee gets one email per change, so a series' event is shortened or
 * trimmed rather than cancelled meeting by meeting.
 */
export function cancelOps(session: PlanSession, series: PlanSession[], rest: boolean, url: string): CalendarOp[] {
  const start = Date.parse(session.starts_at)
  const all = series.length ? series : [session]
  const cancelled = rest ? all.filter((s) => Date.parse(s.starts_at) >= start) : [session]
  const left = all.filter((s) => !cancelled.some((c) => c.id === s.id))
  const ops: CalendarOp[] = []
  for (const eventId of new Set(cancelled.map((s) => s.calendar_event_id))) {
    if (!eventId) continue
    const shared = all.filter((s) => s.calendar_event_id === eventId).length > 1
    const kept = left.filter((s) => s.calendar_event_id === eventId)
    if (!shared || kept.length === 0) {
      ops.push({ kind: 'delete', eventId })
    } else if (eventProvider(eventId) === 'outlook') {
      ops.push(
        rest
          ? { kind: 'end_series', eventId, lastStartsAt: kept[kept.length - 1].starts_at }
          : { kind: 'delete_occurrence', eventId, startsAt: session.starts_at, endsAt: session.ends_at },
      )
    } else if (session.series_id) {
      // Google: re-sync the series' event so it only lists the meetings that remain.
      ops.push({ kind: 'sync_series', seriesId: session.series_id, url, provider: 'google' })
    }
  }
  return ops
}
