// Repeating meetings. A rule is expanded in the browser into the exact list of
// start times, and the database stores them as ordinary rows (one series_id).
// Everything works on local wall-clock time, so "10:00 every weekday" stays at
// 10:00 across a daylight-saving change.

export const MAX_OCCURRENCES = 60
export const DEFAULT_OCCURRENCES = 10

export type RepeatKind = 'none' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'dates'

export type RepeatEnd = { mode: 'count'; count: number } | { mode: 'until'; until: string }

export type RepeatRule = {
  kind: RepeatKind
  /** Weekly: days of the week, 0 = Sunday … 6 = Saturday. */
  days: number[]
  /** Specific dates ("YYYY-MM-DD"), used when kind is 'dates'. */
  dates: string[]
  end: RepeatEnd
}

export const repeatKinds: { value: RepeatKind; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday (Mon–Fri)' },
  { value: 'weekends', label: 'Every weekend (Sat–Sun)' },
  { value: 'weekly', label: 'Weekly on chosen days' },
  { value: 'dates', label: 'On specific dates' },
]

export const noRepeat = (): RepeatRule => ({
  kind: 'none',
  days: [],
  dates: [],
  end: { mode: 'count', count: DEFAULT_OCCURRENCES },
})

const pad = (n: number) => String(n).padStart(2, '0')

export const toDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** "YYYY-MM-DD" → local midnight; null when it isn't a real date. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null
}

function atTime(day: Date, time: string): Date | null {
  const match = /^(\d{2}):(\d{2})/.exec(time)
  if (!match) return null
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(match[1]), Number(match[2]))
}

const matchesDay = (rule: RepeatRule, weekday: number) => {
  switch (rule.kind) {
    case 'daily':
      return true
    case 'weekdays':
      return weekday >= 1 && weekday <= 5
    case 'weekends':
      return weekday === 0 || weekday === 6
    case 'weekly':
      return rule.days.includes(weekday)
    default:
      return false
  }
}

/**
 * Every start time the rule produces, soonest first (at most MAX_OCCURRENCES).
 * `startDate`/`time` are the first meeting's local date and time; for 'dates'
 * the chosen dates are used instead of `startDate`.
 */
export function generateStarts(startDate: string, time: string, rule: RepeatRule): Date[] {
  const first = parseDateKey(startDate)
  if (!first) return []

  if (rule.kind === 'none') {
    const only = atTime(first, time)
    return only ? [only] : []
  }

  if (rule.kind === 'dates') {
    return [...new Set(rule.dates)]
      .sort()
      .slice(0, MAX_OCCURRENCES)
      .flatMap((key) => {
        const day = parseDateKey(key)
        const start = day && atTime(day, time)
        return start ? [start] : []
      })
  }

  const limit = rule.end.mode === 'count' ? Math.min(rule.end.count, MAX_OCCURRENCES) : MAX_OCCURRENCES
  const until = rule.end.mode === 'until' ? parseDateKey(rule.end.until) : null
  if (rule.end.mode === 'until' && !until) return []

  const starts: Date[] = []
  // A year of days is more than enough to find 60 matches for any rule.
  for (let offset = 0; offset < 366 && starts.length < limit; offset++) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset)
    if (until && day > until) break
    if (!matchesDay(rule, day.getDay())) continue
    const start = atTime(day, time)
    if (start) starts.push(start)
  }
  return starts
}

const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

/** Short weekday names in Sunday-first order, for the day chips. */
export const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, i) => weekdayShort.format(new Date(2024, 0, 7 + i)))

/** "Every weekday · 10 meetings · Oct 8 – Oct 21" */
export function describeSeries(rule: RepeatRule, starts: Date[]): string {
  if (rule.kind === 'none' || starts.length === 0) return ''
  const label =
    rule.kind === 'weekly'
      ? `Weekly on ${rule.days
          .slice()
          .sort((a, b) => a - b)
          .map((d) => WEEKDAY_NAMES[d])
          .join(', ')}`
      : rule.kind === 'dates'
        ? 'Specific dates'
        : (repeatKinds.find((k) => k.value === rule.kind)?.label.replace(/ \(.*\)/, '') ?? '')
  const count = `${starts.length} ${starts.length === 1 ? 'meeting' : 'meetings'}`
  const first = starts[0]
  const last = starts[starts.length - 1]
  const range = starts.length > 1 ? `${monthDay.format(first)} – ${monthDay.format(last)}` : monthDay.format(first)
  return [label, count, range].join(' · ')
}

/** Why the rule can't be used yet, or null when it's fine. */
export function repeatProblem(rule: RepeatRule, starts: Date[]): string | null {
  if (rule.kind === 'none') return null
  if (rule.kind === 'weekly' && rule.days.length === 0) return 'Pick at least one day of the week.'
  if (rule.kind === 'dates' && rule.dates.length === 0) return 'Pick at least one date on the calendar.'
  if (rule.kind === 'dates' && rule.dates.length > MAX_OCCURRENCES) return `Pick at most ${MAX_OCCURRENCES} dates.`
  if (rule.end.mode === 'until' && rule.kind !== 'dates' && !parseDateKey(rule.end.until)) return 'Pick an end date.'
  if (starts.length === 0) return 'No meetings fall in that range. Try a later end date.'
  return null
}

/** Google Calendar RDATE line (local time in `timeZone`) for the occurrences after the first. */
export function toRdate(starts: Date[], timeZone: string): string | null {
  if (starts.length < 2) return null
  const stamp = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
  return `RDATE;TZID=${timeZone}:${starts.slice(1).map(stamp).join(',')}`
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** A regular repeat: every day, or every week on these weekdays (0 = Sunday), `count` times. */
export type RepeatPattern = { freq: 'daily' } | { freq: 'weekly'; days: number[] }

/**
 * The pattern these start times follow, or null when they don't form a regular
 * one (hand-picked dates, or an occurrence whose time was edited).
 */
export function inferPattern(starts: Date[]): RepeatPattern | null {
  if (starts.length < 2) return null
  // One rule can only describe occurrences at the same time of day.
  const [first] = starts
  if (starts.some((d) => d.getHours() !== first.getHours() || d.getMinutes() !== first.getMinutes())) return null

  const last = starts[starts.length - 1]
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  // Consecutive days are a daily rule, whatever weekdays they happen to land on.
  const DAY_MS = 24 * 60 * 60_000
  const consecutive = starts.every((d, i) => i === 0 || dayOf(d) - dayOf(starts[i - 1]) === DAY_MS)
  if (consecutive) return { freq: 'daily' }

  const weekdays = [...new Set(starts.map((d) => d.getDay()))].sort((a, b) => a - b)

  // The rule holds only if every matching day in the range is actually a meeting.
  const expected: number[] = []
  for (
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    day.getTime() <= dayOf(last);
    day.setDate(day.getDate() + 1)
  ) {
    if (weekdays.includes(day.getDay())) expected.push(day.getTime())
  }
  const actual = starts.map(dayOf)
  if (expected.length !== actual.length || expected.some((time, i) => time !== actual[i])) return null

  return { freq: 'weekly', days: weekdays }
}

/**
 * An RRULE describing these start times, or null when they have no regular
 * pattern. Used to hand a whole series to Google Calendar in one link, since a
 * calendar URL can carry a rule but not a list of dates.
 */
export function inferRecurrence(starts: Date[]): string | null {
  const pattern = inferPattern(starts)
  if (!pattern) return null
  const count = starts.length
  if (pattern.freq === 'daily') return `RRULE:FREQ=DAILY;COUNT=${count}`
  return `RRULE:FREQ=WEEKLY;BYDAY=${pattern.days.map((d) => DAY_CODES[d]).join(',')};COUNT=${count}`
}
