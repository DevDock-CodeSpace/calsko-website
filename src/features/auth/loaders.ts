import type { User } from '@supabase/supabase-js'
import { redirect, type LoaderFunctionArgs } from 'react-router'
import { ensureSessionClock, sessionExpired, startSessionClock } from '@/lib/auth-storage'
import { activityExpired, startActivityClock, wasIdleSignOut } from '@/lib/inactivity'
import { EXPIRED_REASON, INACTIVE_REASON, INACTIVITY_LIMIT_MS } from '@/lib/inactivity-config'
import { saveMyTimeZone } from '@/features/email/api'
import { getCurrentSession, signOutForInactivity, signOutForSessionLimit } from './api'
import { captureCalendarToken, clearCalendarToken } from './google-calendar'
import { isLoginErrorCode, type LoginErrorCode } from './errors'
import { DEFAULT_AFTER_LOGIN, nextForUser, safeNextPath, takeNextPath } from './redirect'

function loginUrl(params: { next?: string; error?: LoginErrorCode; inactive?: boolean; expired?: boolean }) {
  const search = new URLSearchParams()
  if (params.next && params.next !== DEFAULT_AFTER_LOGIN) search.set('next', params.next)
  if (params.error) search.set('error', params.error)
  if (params.inactive) search.set('reason', INACTIVE_REASON)
  else if (params.expired) search.set('reason', EXPIRED_REASON)
  const query = search.toString()
  return query ? `/login?${query}` : '/login'
}

/**
 * Route guard for loaders: returns the signed-in user or redirects to /login,
 * remembering the requested URL. UX only; the database enforces access via RLS.
 */
export async function requireUser(request: Request): Promise<User> {
  const url = new URL(request.url)
  const next = safeNextPath(url.pathname + url.search)
  let session
  try {
    session = await getCurrentSession()
  } catch {
    throw redirect(loginUrl({ next, error: 'session' }))
  }
  // Signed out for inactivity by another tab: say so on the login page.
  if (!session) throw redirect(loginUrl({ next, inactive: wasIdleSignOut() }))
  // Away for longer than the limit (a tab opened the next morning): sign out before
  // any page data is requested. InactivityGuard does the same for a page that is open.
  if (activityExpired(INACTIVITY_LIMIT_MS)) {
    // If it fails (offline), the login page still shows and the next visit tries again.
    await signOutForInactivity().catch(() => undefined)
    throw redirect(loginUrl({ next, inactive: true }))
  }
  // Older than its limit (4 h, or 12 h when remembered; lib/auth-storage).
  ensureSessionClock()
  if (sessionExpired()) {
    await signOutForSessionLimit().catch(() => undefined)
    throw redirect(loginUrl({ next, expired: true }))
  }
  return session.user
}

export async function loginLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get('next'))
  // Already signed in: skip the login page. A restore failure just shows the page.
  const session = await getCurrentSession().catch(() => null)
  if (session) throw redirect(await nextForUser(next, session.user.id))

  const error = url.searchParams.get('error')
  const reason = url.searchParams.get('reason')
  return { next, error: isLoginErrorCode(error) ? error : null, inactive: reason === INACTIVE_REASON, expired: reason === EXPIRED_REASON }
}

/**
 * Google → Supabase → here. With PKCE, supabase-js exchanges the ?code= for a
 * session on startup (detectSessionInUrl); getSession() waits for that. This
 * loader only interprets the outcome and never renders a page of its own.
 */
export async function authCallbackLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const oauthError = url.searchParams.get('error') ?? hash.get('error')
  const next = takeNextPath()

  if (oauthError) {
    const description = url.searchParams.get('error_description') ?? hash.get('error_description')
    console.error('[auth] OAuth provider returned an error', oauthError, description)
    clearCalendarToken()
    throw redirect(loginUrl({ next, error: oauthError === 'access_denied' ? 'cancelled' : 'oauth' }))
  }

  let session
  try {
    session = await getCurrentSession()
  } catch {
    throw redirect(loginUrl({ next, error: 'callback' }))
  }
  if (!session) {
    console.error('[auth] Callback reached without a session (code missing, expired, or already used)')
    throw redirect(loginUrl({ next, error: 'callback' }))
  }
  const calendarOnly = captureCalendarToken(session)
  // Signing in is activity: an old timestamp must not sign them straight back out.
  startActivityClock()
  // A new sign-in starts the session's time limit; connecting Google Calendar doesn't extend it.
  if (!calendarOnly) {
    startSessionClock()
    // Emails write times in the reader's zone.
    saveMyTimeZone()
  }
  throw redirect(await nextForUser(next, session.user.id))
}
