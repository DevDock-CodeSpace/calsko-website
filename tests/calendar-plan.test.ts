// Calendar invites (src/features/live/calendar-plan.ts, recurrence.ts): which
// repeat pattern a series follows, and what changes in Google Calendar or
// Outlook when meetings are cancelled. No browser, no network.
//
//   npm run test:calendar   (pins TZ to America/Chicago, a zone with DST)
import { cancelOps, eventProvider, idFor, opProvider, providerEventId, storedEventId, syncProvider } from '../src/features/live/calendar-plan.ts'
import { inferPattern, inferRecurrence } from '../src/features/live/recurrence.ts'

function assertEquals(actual: unknown, expected: unknown, message = '') {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${message ? message + ': ' : ''}expected ${b}, got ${a}`)
}

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0)

Deno.test('weekday meetings are a weekly pattern, across a DST change', () => {
  // Mon 26 Oct 2026 to Fri 6 Nov 2026; DST ends on 1 Nov in Chicago.
  const starts = [26, 27, 28, 29, 30].map((d) => at(2026, 10, d)).concat([2, 3, 4, 5, 6].map((d) => at(2026, 11, d)))
  assertEquals(inferPattern(starts), { freq: 'weekly', days: [1, 2, 3, 4, 5] })
  assertEquals(inferRecurrence(starts), 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=10')
})

Deno.test('consecutive days are daily', () => {
  assertEquals(inferPattern([at(2026, 11, 20), at(2026, 11, 21), at(2026, 11, 22)]), { freq: 'daily' })
})

Deno.test('a skipped or moved meeting breaks the pattern', () => {
  // Weekdays for two weeks, but the first week's Wednesday was cancelled.
  const skipped = [16, 17, 19, 20, 23, 24, 25, 26, 27].map((d) => at(2026, 11, d))
  assertEquals(inferPattern(skipped), null, 'one Wednesday missing')
  assertEquals(inferPattern([at(2026, 11, 16), at(2026, 11, 23, 15), at(2026, 11, 30)]), null, 'one at another time')
  assertEquals(inferPattern([at(2026, 11, 16)]), null, 'one meeting')
})

Deno.test('event ids carry their calendar', () => {
  assertEquals(storedEventId('outlook', 'AQMk=='), 'outlook:AQMk==')
  assertEquals(storedEventId('google', 'abc123'), 'abc123')
  assertEquals(eventProvider('outlook:AQMk=='), 'outlook')
  assertEquals(eventProvider('abc123'), 'google')
  assertEquals(providerEventId('outlook:AQMk=='), 'AQMk==')
  assertEquals(idFor('google', 'outlook:AQMk=='), null)
  assertEquals(idFor('outlook', 'outlook:AQMk=='), 'AQMk==')
  assertEquals(opProvider({ kind: 'sync', sessionId: 's', url: 'u' }), 'google', 'queued before Outlook existed')
  assertEquals(opProvider({ kind: 'delete', eventId: 'outlook:x' }), 'outlook')
})

Deno.test('an existing invite keeps its calendar; a new one uses the choice', () => {
  const base = { id: 'a', series_id: null, starts_at: '', ends_at: '' }
  assertEquals(syncProvider({ ...base, calendar_event_id: 'outlook:x' }, 'google'), 'outlook')
  assertEquals(syncProvider({ ...base, calendar_event_id: 'g1' }, 'outlook'), 'google')
  assertEquals(syncProvider({ ...base, calendar_event_id: null }, 'outlook'), 'outlook')
  assertEquals(syncProvider(undefined, 'google'), 'google')
})

// A five-meeting series, Mon 16 to Fri 20 Nov 2026 at 10:00.
function series(eventIds: (string | null)[]) {
  return eventIds.map((id, i) => ({
    id: `m${i + 1}`,
    series_id: 'S',
    starts_at: at(2026, 11, 16 + i).toISOString(),
    ends_at: at(2026, 11, 16 + i, 11).toISOString(),
    calendar_event_id: id,
  }))
}
const URL = 'https://calsko.test/m'

Deno.test('cancelling a one-off meeting cancels its event', () => {
  const one = { id: 'x', series_id: null, starts_at: at(2026, 11, 16).toISOString(), ends_at: '', calendar_event_id: 'outlook:E' }
  assertEquals(cancelOps(one, [], false, URL), [{ kind: 'delete', eventId: 'outlook:E' }])
  assertEquals(cancelOps({ ...one, calendar_event_id: null }, [], false, URL), [], 'never invited')
})

Deno.test('Outlook repeating event: one meeting, the rest, everything', () => {
  const s = series(Array(5).fill('outlook:R'))
  assertEquals(cancelOps(s[2], s, false, URL), [
    { kind: 'delete_occurrence', eventId: 'outlook:R', startsAt: s[2].starts_at, endsAt: s[2].ends_at },
  ])
  assertEquals(cancelOps(s[3], s, true, URL), [{ kind: 'end_series', eventId: 'outlook:R', lastStartsAt: s[2].starts_at }])
  assertEquals(cancelOps(s[0], s, true, URL), [{ kind: 'delete', eventId: 'outlook:R' }])
})

Deno.test('Outlook event per meeting: each cancelled meeting cancels its own', () => {
  const s = series(['outlook:1', 'outlook:2', 'outlook:3', 'outlook:4', 'outlook:5'])
  assertEquals(cancelOps(s[1], s, false, URL), [{ kind: 'delete', eventId: 'outlook:2' }])
  assertEquals(cancelOps(s[3], s, true, URL), [
    { kind: 'delete', eventId: 'outlook:4' },
    { kind: 'delete', eventId: 'outlook:5' },
  ])
})

Deno.test('Google series event: re-synced so it drops the cancelled dates', () => {
  const s = series(Array(5).fill('G'))
  const resync = [{ kind: 'sync_series', seriesId: 'S', url: URL, provider: 'google' }] as const
  assertEquals(cancelOps(s[2], s, false, URL), resync, 'one meeting')
  assertEquals(cancelOps(s[3], s, true, URL), resync, 'the rest')
  assertEquals(cancelOps(s[0], s, true, URL), [{ kind: 'delete', eventId: 'G' }], 'everything')
})

Deno.test('a series still loading counts as just this meeting', () => {
  const [first] = series(['outlook:R'])
  assertEquals(cancelOps(first, [], true, URL), [{ kind: 'delete', eventId: 'outlook:R' }])
})
