// PostHog: pulled once a day through its query API (HogQL), so a crash that happened 10,000 times is
// one row here, not 10,000 calls. PostHog already groups exceptions into its own issues
// ($exception_issue_id); we keep that id as the fingerprint, so Calsko's grouping matches PostHog's.
//
// Needs a personal API key with "Query: Read" and the project id (Settings → Project).
// https://posthog.com/docs/api/queries — 10 s per query, 240 requests a minute.

import { type ErrorProvider, type ErrorReport, isoDay, mergeReports, type PullContext, SourceProblem } from '../types.ts'

const ROW_LIMIT = 5000

type Frame = Record<string, unknown>
type Exception = { type?: unknown; value?: unknown; stacktrace?: { frames?: unknown } }

/** A ClickHouse DateTime literal in UTC: 'YYYY-MM-DD HH:MM:SS'. */
const chTime = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ')

export function buildQuery(since: Date, until: Date): string {
  return `
    SELECT
      coalesce(nullIf(toString(properties.$exception_issue_id), ''), nullIf(toString(properties.$exception_fingerprint), ''), '') AS gid,
      toDate(timestamp) AS day,
      count() AS occurrences,
      min(timestamp) AS first_ts,
      max(timestamp) AS last_ts,
      argMax(properties.$exception_list, timestamp) AS list,
      argMax(properties.$exception_types, timestamp) AS types,
      argMax(properties.$exception_values, timestamp) AS vals,
      argMax(properties.$current_url, timestamp) AS page,
      argMax(properties.$browser, timestamp) AS browser,
      argMax(properties.$os, timestamp) AS os
    FROM events
    WHERE event = '$exception'
      AND timestamp > toDateTime('${chTime(since)}', 'UTC')
      AND timestamp <= toDateTime('${chTime(until)}', 'UTC')
    GROUP BY gid, day
    ORDER BY occurrences DESC
    LIMIT ${ROW_LIMIT}`
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const str = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

function frameLine(frame: Frame): string {
  const name = str(frame.resolved_name) || str(frame.mangled_name) || str(frame.function) || '<anonymous>'
  const file = str(frame.source) || str(frame.filename) || str(frame.abs_path)
  const line = str(frame.line) || str(frame.lineno)
  const column = str(frame.column) || str(frame.colno)
  const where = [file, line, column].filter(Boolean).join(':')
  return where ? `    at ${name} (${where})` : `    at ${name}`
}

/** The error as JavaScript prints it: "Type: message", then frames, innermost first. */
export function exceptionText(list: unknown, types: unknown, values: unknown): { title: string; stack: string } {
  const exceptions = parseMaybeJson(list)
  if (Array.isArray(exceptions) && exceptions.length > 0) {
    const blocks = (exceptions as Exception[]).slice(0, 5).map((e) => {
      const heading = [str(e.type), str(e.value)].filter(Boolean).join(': ') || 'Error'
      const frames = Array.isArray(e.stacktrace?.frames) ? (e.stacktrace!.frames as Frame[]) : []
      // PostHog (like Sentry) stores frames outermost first; people read the innermost first.
      const lines = frames.slice(-30).reverse().map(frameLine)
      return [heading, ...lines].join('\n')
    })
    return { title: blocks[0].split('\n')[0], stack: blocks.join('\n\nCaused by:\n') }
  }
  const type = str((parseMaybeJson(types) as unknown[] | undefined)?.[0])
  const value = str((parseMaybeJson(values) as unknown[] | undefined)?.[0])
  const title = [type, value].filter(Boolean).join(': ') || 'Error'
  return { title, stack: title }
}

/** One result row → one report. Columns are in buildQuery's order. */
export function rowToReport(row: unknown[], context: { host: string; projectId: string }): ErrorReport | null {
  const [gid, day, occurrences, firstTs, lastTs, list, types, vals, page, browser, os] = row
  const count = Number(occurrences)
  if (!Number.isFinite(count) || count <= 0) return null
  const { title, stack } = exceptionText(list, types, vals)
  const id = str(gid)
  const meta = [
    str(page) && `Page: ${str(page)}`,
    (str(browser) || str(os)) && `Browser: ${[str(browser), str(os)].filter(Boolean).join(' · ')}`,
  ].filter(Boolean)
  const toIso = (value: unknown) => {
    const date = new Date(str(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(str(value)) ? '' : 'Z'))
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return {
    // Without a PostHog id (very old events) the title is the best grouping we have.
    fingerprint: id ? `ph_${id}`.slice(0, 200) : `ph_title_${title}`.slice(0, 200),
    title: title.slice(0, 300),
    raw: [stack, ...(meta.length ? ['', ...meta] : [])].join('\n').slice(0, 20000),
    url: /^[0-9a-f-]{36}$/i.test(id) ? `${context.host}/project/${context.projectId}/error_tracking/${id}` : undefined,
    firstSeen: toIso(firstTs),
    lastSeen: toIso(lastTs),
    days: [{ day: str(day).slice(0, 10) || isoDay(new Date()), count }],
  }
}

/** PostHog's own reason ("API key missing required scope 'query:read'"), short, for the source's status line. */
export async function posthogReason(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown }
    const detail = typeof body.detail === 'string' ? body.detail : typeof body.message === 'string' ? body.message : ''
    return detail.replace(/\s+/g, ' ').trim().slice(0, 200)
  } catch {
    return ''
  }
}

async function pull({ config, apiKey, since, until, fetch }: PullContext): Promise<ErrorReport[]> {
  const host = str(config.host) || 'https://us.posthog.com'
  const projectId = str(config.project_id)
  const response = await fetch(`${host}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: buildQuery(since, until) }, name: 'calsko error sync' }),
    signal: AbortSignal.timeout(40_000),
  })
  if (response.status === 401 || response.status === 403) {
    const reason = await posthogReason(response)
    throw new SourceProblem(`PostHog refused the API key${reason ? `: ${reason}` : '. It needs the "Query: Read" scope for this project.'}`)
  }
  if (response.status === 404) {
    const reason = await posthogReason(response)
    throw new SourceProblem(`PostHog has no project with that id here. Check the project id and US/EU.${reason ? ` (${reason})` : ''}`)
  }
  if (response.status === 429) {
    await response.body?.cancel()
    throw new Error('PostHog rate limit reached; the next sync will try again')
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`PostHog query failed (${response.status}): ${detail}`)
  }
  const body = (await response.json()) as { results?: unknown }
  if (!Array.isArray(body.results)) throw new Error('PostHog answered without results')
  const reports = (body.results as unknown[])
    .filter(Array.isArray)
    .map((row) => rowToReport(row as unknown[], { host, projectId }))
    .filter((r): r is ErrorReport => r !== null)
  return mergeReports(reports)
}

export const posthogProvider: ErrorProvider = { id: 'posthog', label: 'PostHog', pull }
