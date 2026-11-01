// The generic webhook: Calsko's own format, for any tool that can send an alert to a URL (and your own
// code, Zapier, …). Documented in docs/ERROR_TRACKING.md. One request may carry one error or a list:
//
//   { "errors": [ { "title": "TypeError: x is undefined",   // or "message" (one of the two)
//                   "type": "TypeError", "message": "x is undefined",
//                   "stack": "…", "page": "https://…", "link": "https://tracker/…",
//                   "fingerprint": "abc", "count": 3, "timestamp": "2026-11-01T10:00:00Z",
//                   "environment": "production", "release": "1.4.2", "details": "anything else" } ] }
//
// Without a fingerprint, ours is used (fingerprint.ts). Count defaults to 1.

import { fingerprint } from '../fingerprint.ts'
import { BadPayload, type ErrorProvider, type ErrorReport, isoDay, mergeReports } from '../types.ts'

export const MAX_ERRORS_PER_REQUEST = 100

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function when(value: unknown, now: Date): Date {
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
    // Future stamps and anything older than 90 days count as now.
    if (!Number.isNaN(date.getTime()) && date <= now && now.getTime() - date.getTime() < 90 * 86_400_000) return date
  }
  return now
}

/** The exact error as text, in the order a person reads it. */
export function rawText(error: Record<string, unknown>): string {
  const lines: string[] = []
  const type = text(error.type, 200)
  const message = text(error.message, 4000)
  const title = text(error.title, 300)
  const heading = type && message ? `${type}: ${message}` : message || title
  const stack = text(error.stack, 12000)
  // Stacks often start with the message itself (V8 does); don't print it twice.
  if (!stack.startsWith(heading)) lines.push(heading)
  if (stack) lines.push(stack)
  const meta: [string, unknown][] = [
    ['Page', error.page ?? error.url],
    ['Environment', error.environment],
    ['Release', error.release],
  ]
  const extra = meta.filter(([, v]) => text(v, 500)).map(([k, v]) => `${k}: ${text(v, 500)}`)
  if (extra.length) lines.push('', ...extra)
  const details = typeof error.details === 'string' ? error.details : error.details ? JSON.stringify(error.details, null, 2) : ''
  if (details) lines.push('', details.slice(0, 3000))
  return lines.join('\n').slice(0, 20000)
}

async function toReport(error: unknown, now: Date): Promise<ErrorReport | null> {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const e = error as Record<string, unknown>
  const type = text(e.type, 200)
  const message = text(e.message, 4000)
  const title = text(e.title, 300) || (type && message ? `${type}: ${message}` : message).slice(0, 300)
  if (!title) return null
  const count = typeof e.count === 'number' && Number.isFinite(e.count) ? Math.min(Math.max(Math.floor(e.count), 1), 1_000_000) : 1
  const at = when(e.timestamp, now)
  const link = text(e.link, 2000)
  return {
    fingerprint: text(e.fingerprint, 180) ? `ext_${text(e.fingerprint, 180)}` : await fingerprint({ type, message: message || title, stack: text(e.stack, 12000) }),
    title,
    raw: rawText(e),
    url: link.startsWith('https://') ? link : undefined,
    firstSeen: at.toISOString(),
    lastSeen: at.toISOString(),
    days: [{ day: isoDay(at), count }],
  }
}

export async function parseCalskoWebhook(body: unknown, now: Date): Promise<ErrorReport[]> {
  if (!body || typeof body !== 'object') throw new BadPayload('Send a JSON object')
  const list = Array.isArray(body) ? body : Array.isArray((body as { errors?: unknown }).errors) ? (body as { errors: unknown[] }).errors : [body]
  if (list.length > MAX_ERRORS_PER_REQUEST) throw new BadPayload(`At most ${MAX_ERRORS_PER_REQUEST} errors per request`)
  const reports = (await Promise.all(list.map((e) => toReport(e, now)))).filter((r): r is ErrorReport => r !== null)
  if (reports.length === 0) throw new BadPayload('No error with a title or message')
  return mergeReports(reports)
}

export const webhookProvider: ErrorProvider = {
  id: 'webhook',
  label: 'the webhook',
  parseWebhook: parseCalskoWebhook,
}
