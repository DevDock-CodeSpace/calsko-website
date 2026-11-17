import type { Session } from '@supabase/supabase-js'

// Calendar access for organizers: Google Calendar or Outlook (Microsoft Graph).
// The token is the access token Supabase hands back (session.provider_token)
// right after a sign-in that asked for the calendar scope. It lasts about an
// hour and isn't refreshed (there's no server to hold a refresh token), so it
// lives in sessionStorage for this tab and the organizer reconnects when it
// expires; the provider skips the consent screen once the scope was granted.

export type CalendarProvider = 'google' | 'outlook'

/** The OAuth scope each provider needs to create events and invite people. */
export const CALENDAR_SCOPES: Record<CalendarProvider, string> = {
  google: 'https://www.googleapis.com/auth/calendar.events',
  // Microsoft also needs the sign-in scopes, or it leaves the email out.
  outlook: 'openid email profile Calendars.ReadWrite',
}

export const CALENDAR_NAMES: Record<CalendarProvider, string> = {
  google: 'Google Calendar',
  outlook: 'Outlook',
}

const tokenKey = (provider: CalendarProvider) => `devdock:${provider}-calendar`
/** Holds the provider being connected while the browser is away. */
const CONNECTING_KEY = 'devdock:calendar-connecting'
/** Google and Microsoft access tokens last at least 3600 s; stop using one a little early. */
const TOKEN_LIFETIME_MS = 55 * 60_000

type StoredToken = { token: string; expiresAt: number }

export function getCalendarToken(provider: CalendarProvider): string | null {
  try {
    const raw = sessionStorage.getItem(tokenKey(provider))
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<StoredToken>
    if (typeof stored.token !== 'string' || typeof stored.expiresAt !== 'number') return null
    if (Date.now() >= stored.expiresAt) {
      sessionStorage.removeItem(tokenKey(provider))
      return null
    }
    return stored.token
  } catch {
    return null
  }
}

/** Forgets one provider's token, or every calendar token (on sign-out). */
export function clearCalendarToken(provider?: CalendarProvider) {
  try {
    for (const p of provider ? [provider] : (['google', 'outlook'] as const)) sessionStorage.removeItem(tokenKey(p))
    sessionStorage.removeItem(CONNECTING_KEY)
  } catch {
    // Storage blocked: nothing was stored.
  }
}

/** Called just before redirecting to the provider for the calendar scope. */
export function markCalendarConnecting(provider: CalendarProvider) {
  try {
    sessionStorage.setItem(CONNECTING_KEY, provider)
  } catch {
    // Storage blocked: the token can't be kept anyway.
  }
}

/**
 * On the OAuth callback: keep the token only when this sign-in asked for a
 * calendar scope (a plain sign-in's token can't use the calendar API).
 * Returns true when it did: a calendar connection, not a new sign-in.
 */
export function captureCalendarToken(session: Session): boolean {
  try {
    const connecting = sessionStorage.getItem(CONNECTING_KEY)
    sessionStorage.removeItem(CONNECTING_KEY)
    if (connecting !== 'google' && connecting !== 'outlook') return false
    if (session.provider_token) {
      const stored: StoredToken = { token: session.provider_token, expiresAt: Date.now() + TOKEN_LIFETIME_MS }
      sessionStorage.setItem(tokenKey(connecting), JSON.stringify(stored))
    }
    return true
  } catch {
    // Storage blocked: calendar sync asks to connect again.
    return false
  }
}

/**
 * Which calendar new invites go to by default: the one that matches how the
 * organizer last signed in (Microsoft → Outlook, otherwise Google).
 */
export function defaultCalendar(identities: { provider: string; last_sign_in_at?: string | null }[]): CalendarProvider {
  const latest = identities
    .filter((i) => i.provider === 'google' || i.provider === 'azure')
    .sort((a, b) => Date.parse(b.last_sign_in_at ?? '') - Date.parse(a.last_sign_in_at ?? ''))[0]
  return latest?.provider === 'azure' ? 'outlook' : 'google'
}
