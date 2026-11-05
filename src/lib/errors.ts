// Turn Supabase/PostgREST errors into messages that are safe to show users.
// The raw error is always logged (and reported to error tracking); it is never rendered.

import { errorUserKnown, isNoise, reportError } from '@/lib/error-tracking'

type PostgrestLikeError = { code?: string; message?: string }

const byCode: Record<string, string> = {
  '42501': 'You don’t have permission to do that.',
  '23503': 'That person isn’t a member of this group.',
  '23505': 'That already exists.',
  '23514': 'That value isn’t allowed.',
}

export class DataError extends Error {
  readonly code: string | undefined

  constructor(message: string, code?: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DataError'
    this.code = code
  }
}

/**
 * @param action  what we were doing, e.g. "load courses" (used in the fallback message)
 * @param overrides  per-call messages keyed by Postgres error code
 */
export function toDataError(
  action: string,
  error: PostgrestLikeError,
  overrides: Record<string, string> = {},
): DataError {
  console.error(`[data] Failed to ${action}`, error)
  const code = error.code
  const message =
    (code && (overrides[code] ?? byCode[code])) ?? `Couldn’t ${action}. Please try again.`
  const dataError = new DataError(message, code, { cause: error })
  if (shouldReport(code, error.message)) reportError(dataError, { source: 'data', action, code, detail: error.message })
  return dataError
}

/**
 * Offline, or a request that never reached the server, is the person's network, not a bug. Signed out
 * (session lost while a page was open), Postgres refuses everything as anonymous ("permission denied")
 * and Storage answers "Object not found": expected, so not reported either.
 */
function shouldReport(code: string | undefined, message: string | undefined) {
  if (!navigator.onLine || isNoise(new Error(message ?? ''))) return false
  if (!errorUserKnown() && (code === '42501' || message === 'Object not found')) return false
  return true
}

/** RLS turns forbidden UPDATE/DELETE into "0 rows affected" instead of an error. */
export function requireAffected<T>(rows: T[] | null, action: string): T[] {
  if (!rows || rows.length === 0) {
    console.error(`[data] ${action}: no rows affected (not permitted or not found)`)
    throw new DataError(byCode['42501'], '42501')
  }
  return rows
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
