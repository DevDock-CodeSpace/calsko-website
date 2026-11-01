// Sentry: pulled once a day through its organization issues API with a personal auth token (event:read,
// project:read, org:read). Sentry already groups events into issues; we keep its issue id as the
// fingerprint, so Calsko's grouping matches Sentry's.
//
// Per sync:
//   1. the project's numeric id (GET /projects/{org}/{project}/), since the issues API filters by id;
//   2. the issues with events in (since, until], most frequent first, up to 500 (5 pages of 100), each
//      with its daily counts for the last 14 days (groupStatsPeriod=14d) and its lifetime count;
//   3. the latest event of the 25 most frequent, for the exact exception and stack (others get the
//      title and culprit; the issue text only needs it for errors that get an issue).
// Daily counts are whole days ("days_mode: set"), so re-reading a day adds nothing twice.
// https://docs.sentry.io/api/events/list-an-organizations-issues/

import { type ErrorProvider, type ErrorReport, isoDay, type PullContext, SourceProblem } from '../types.ts'

const PAGE = 100
const MAX_PAGES = 5
const EVENTS_FOR = 25
const EVENT_CONCURRENCY = 5

type SentryIssue = {
  id?: string
  title?: string
  culprit?: string
  permalink?: string
  firstSeen?: string
  lastSeen?: string
  count?: string | number
  lifetime?: { count?: string | number } | null
  metadata?: { type?: string; value?: string; filename?: string; function?: string } | null
  stats?: Record<string, [number, number][]>
}

type SentryFrame = { function?: string | null; filename?: string | null; absPath?: string | null; module?: string | null; lineNo?: number | null; colNo?: number | null }
type SentryEvent = {
  entries?: { type?: string; data?: unknown }[]
  tags?: { key?: string; value?: string }[]
}

const str = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

/** Sentry's own reason ({ detail }), short. */
async function sentryReason(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail
    return typeof detail === 'string' ? detail.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  } catch {
    return ''
  }
}

async function get(context: PullContext, url: string): Promise<Response> {
  const response = await context.fetch(url, {
    headers: { Authorization: `Bearer ${context.apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.ok) return response
  const reason = await sentryReason(response)
  if (response.status === 401) throw new SourceProblem(`Sentry refused the token${reason ? `: ${reason}` : '.'} Use a personal auth token.`)
  if (response.status === 403)
    throw new SourceProblem(`Sentry refused the token${reason ? `: ${reason}` : '.'} It needs event:read, project:read and org:read.`)
  if (response.status === 404) throw new SourceProblem('Sentry has no such organization or project here. Check both slugs and US/EU.')
  if (response.status === 429) throw new Error('Sentry rate limit reached; the next sync will try again')
  throw new Error(`Sentry request failed (${response.status}): ${reason}`)
}

/** The next page from Sentry's Link header: rel="next"; results="true"; cursor="…". */
export function nextCursor(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) return part.match(/cursor="([^"]+)"/)?.[1] ?? null
  }
  return null
}

/** The exception as JavaScript prints it, innermost frame first; then page, browser, environment, release. */
export function eventText(event: SentryEvent, fallbackTitle: string): string {
  const exception = event.entries?.find((e) => e.type === 'exception')?.data as
    | { values?: { type?: string; value?: string; stacktrace?: { frames?: SentryFrame[] } | null }[] }
    | undefined
  const blocks = (exception?.values ?? []).slice(-5).reverse().map((v) => {
    const heading = [str(v.type), str(v.value)].filter(Boolean).join(': ') || 'Error'
    const frames = (v.stacktrace?.frames ?? []).slice(-30).reverse().map((f) => {
      const name = str(f.function) || '<anonymous>'
      const file = str(f.filename) || str(f.absPath) || str(f.module)
      const where = [file, str(f.lineNo), str(f.colNo)].filter(Boolean).join(':')
      return where ? `    at ${name} (${where})` : `    at ${name}`
    })
    return [heading, ...frames].join('\n')
  })
  const tag = (key: string) => str(event.tags?.find((t) => t.key === key)?.value)
  const request = event.entries?.find((e) => e.type === 'request')?.data as { url?: string } | undefined
  const meta = [
    str(request?.url) && `Page: ${str(request?.url)}`,
    (tag('browser') || tag('os')) && `Browser: ${[tag('browser'), tag('os')].filter(Boolean).join(' · ')}`,
    tag('environment') && `Environment: ${tag('environment')}`,
    tag('release') && `Release: ${tag('release')}`,
  ].filter(Boolean)
  const body = blocks.length ? blocks.join('\n\nCaused by:\n') : fallbackTitle
  return [body, ...(meta.length ? ['', ...meta] : [])].join('\n').slice(0, 20000)
}

/** One Sentry issue → one report, with whole-day counts on or after `since`'s day. */
export function issueToReport(issue: SentryIssue, since: Date): ErrorReport | null {
  if (!issue.id) return null
  const fromDay = isoDay(since)
  const buckets = issue.stats?.['14d'] ?? issue.stats?.['24h'] ?? []
  const byDay = new Map<string, number>()
  for (const [ts, count] of buckets) {
    if (!(count > 0)) continue
    const day = isoDay(new Date(ts * 1000))
    if (day >= fromDay) byDay.set(day, (byDay.get(day) ?? 0) + count)
  }
  const title = str(issue.title) || [str(issue.metadata?.type), str(issue.metadata?.value)].filter(Boolean).join(': ') || 'Error'
  const lifetime = Number(str(issue.lifetime?.count) || NaN)
  return {
    fingerprint: `sentry_${issue.id}`,
    title: title.slice(0, 300),
    raw: [title, issue.culprit ? `    at ${issue.culprit}` : ''].filter(Boolean).join('\n'),
    url: str(issue.permalink).startsWith('https://') ? str(issue.permalink) : undefined,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    days: [...byDay].map(([day, count]) => ({ day, count })),
    daysMode: 'set',
    total: Number.isFinite(lifetime) ? lifetime : undefined,
  }
}

async function pull(context: PullContext): Promise<ErrorReport[]> {
  const host = str(context.config.host) || 'https://sentry.io'
  const org = encodeURIComponent(str(context.config.org))
  const project = await (await get(context, `${host}/api/0/projects/${org}/${encodeURIComponent(str(context.config.project))}/`)).json() as { id?: string }
  if (!project.id) throw new SourceProblem('Sentry didn’t return the project. Check the project slug.')

  const issues: SentryIssue[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      project: project.id,
      start: context.since.toISOString(),
      end: context.until.toISOString(),
      groupStatsPeriod: '14d',
      // Every status: resolved issues that happened again are exactly the ones to know about.
      query: '',
      sort: 'freq',
      limit: String(PAGE),
    })
    if (cursor) params.set('cursor', cursor)
    const response = await get(context, `${host}/api/0/organizations/${org}/issues/?${params}`)
    const batch = (await response.json()) as SentryIssue[]
    if (!Array.isArray(batch)) throw new Error('Sentry answered without a list of issues')
    issues.push(...batch)
    cursor = nextCursor(response.headers.get('link'))
    if (!cursor) break
  }

  const reports = issues.map((issue) => issueToReport(issue, context.since)).filter((r): r is ErrorReport => r !== null)

  // The exact error for the most frequent ones (the ones most likely to need an issue now).
  const top = reports.slice(0, EVENTS_FOR)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(EVENT_CONCURRENCY, top.length) }, async () => {
      while (next < top.length) {
        const report = top[next++]
        const id = report.fingerprint.slice('sentry_'.length)
        try {
          const event = (await (await get(context, `${host}/api/0/organizations/${org}/issues/${encodeURIComponent(id)}/events/latest/`)).json()) as SentryEvent
          report.raw = eventText(event, report.title)
        } catch (e) {
          // One unreadable event keeps the title and culprit; a refused token stops the sync.
          if (e instanceof SourceProblem) throw e
        }
      }
    }),
  )
  return reports
}

export const sentryProvider: ErrorProvider = { id: 'sentry', label: 'Sentry', pull }
