// Error tracking's one shape. Every provider (PostHog, the generic webhook, later Sentry, CloudWatch…)
// turns what it has into ErrorReports; everything after that (counting, issues, AI) is shared and never
// knows which provider it came from. See docs/ERROR_TRACKING.md.

/** One kind of error and the occurrences not reported before (never one report per occurrence). */
export type ErrorReport = {
  /** Stable id for this kind of error: the provider's own (PostHog issue id) or ours (fingerprint.ts). */
  fingerprint: string
  /** "TypeError: x is undefined". */
  title: string
  /** The exact error as text: message, stack, page, browser. Copied word for word into the issue. */
  raw: string
  /** This error in the tracker ("Open in PostHog"); https only. */
  url?: string
  firstSeen?: string
  lastSeen?: string
  /** Occurrences per UTC day, as 'YYYY-MM-DD'. */
  days: { day: string; count: number }[]
}

/** What a pulled provider gets: its source's settings and secret, and the window to report. */
export type PullContext = {
  config: Record<string, unknown>
  apiKey: string
  since: Date
  until: Date
  fetch: typeof fetch
}

export interface ErrorProvider {
  readonly id: string
  /** "PostHog": used in issue text ("Open in PostHog") and messages. */
  readonly label: string
  /** Pulled providers: the errors in (since, until]. */
  pull?(context: PullContext): Promise<ErrorReport[]>
  /** Pushed providers: one webhook request's body → reports. Throws BadPayload on input it can't read. */
  parseWebhook?(body: unknown, now: Date): Promise<ErrorReport[]>
}

export class BadPayload extends Error {}

/** Something the person can fix (a wrong key, a wrong project id), shown on the source as is. */
export class SourceProblem extends Error {}

export const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/** Reports for one fingerprint merged: days added up, the latest sample kept. */
export function mergeReports(reports: ErrorReport[]): ErrorReport[] {
  const merged = new Map<string, ErrorReport>()
  for (const report of reports) {
    const existing = merged.get(report.fingerprint)
    if (!existing) {
      merged.set(report.fingerprint, { ...report, days: [...report.days] })
      continue
    }
    for (const { day, count } of report.days) {
      const same = existing.days.find((d) => d.day === day)
      if (same) same.count += count
      else existing.days.push({ day, count })
    }
    const later = (report.lastSeen ?? '') > (existing.lastSeen ?? '')
    if (later) {
      existing.title = report.title
      existing.raw = report.raw || existing.raw
      existing.lastSeen = report.lastSeen
    }
    existing.url ??= report.url
    if (report.firstSeen && (!existing.firstSeen || report.firstSeen < existing.firstSeen)) existing.firstSeen = report.firstSeen
  }
  return [...merged.values()]
}
