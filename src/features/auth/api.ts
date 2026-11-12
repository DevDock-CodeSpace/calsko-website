import type { Session, User } from '@supabase/supabase-js'
import { queryOptions } from '@tanstack/react-query'
import { SETTLED_STALE_MS } from '@/lib/query-client'
import { authStorage, clearSessionClock, startSessionClock } from '@/lib/auth-storage'
import { clearActivityClock, markIdleSignOut, startActivityClock } from '@/lib/inactivity'
import { saveMyTimeZone } from '@/features/email/api'
import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabase'
import type { Tables } from '@/types/database.types'
import { AuthFlowError } from './errors'
import { CALENDAR_SCOPE, clearCalendarToken, markCalendarConnecting } from './google-calendar'
import { rememberNextPath } from './redirect'
import { logError } from '@/lib/error-tracking'

export type Profile = Tables<'profiles'>

export const AUTH_CALLBACK_PATH = '/auth/callback'

export type StarterPagePreference =
  | { type: 'chat' }
  | { type: 'my-issues' }
  | { type: 'project' | 'course'; workspaceId: string }

const STARTER_PAGES_METADATA_KEY = 'devdock:starter-pages'

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseStarterPage(value: unknown): StarterPagePreference | null {
  const record = objectValue(value)
  if (!record) return null
  if (record.type === 'chat' || record.type === 'my-issues') return { type: record.type }
  if ((record.type === 'project' || record.type === 'course') && typeof record.workspaceId === 'string') {
    return { type: record.type, workspaceId: record.workspaceId }
  }
  return null
}

function sameStarterPage(a: StarterPagePreference | null, b: StarterPagePreference | null): boolean {
  if (!a || !b) return a === b
  if (a.type !== b.type) return false
  return !('workspaceId' in a) || ('workspaceId' in b && a.workspaceId === b.workspaceId)
}

function starterPagesFromMetadata(metadata: unknown): Record<string, unknown> {
  return objectValue(objectValue(metadata)?.[STARTER_PAGES_METADATA_KEY]) ?? {}
}

function authPreferenceError(action: string, error: unknown): Error {
  logError(`[auth] Failed to ${action}`, error)
  return new Error(`Couldn’t ${action}. Please try again.`, { cause: error })
}

/** The current user's optional, account-synced starting page for one group. */
export const starterPagePreferenceQuery = (userId: string, teamId: string) =>
  queryOptions({
    queryKey: ['auth', 'starter-page', userId, teamId],
    staleTime: SETTLED_STALE_MS,
    queryFn: async (): Promise<StarterPagePreference | null> => {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw authPreferenceError('load your starter page', error)
      if (!data.user || data.user.id !== userId) {
        throw authPreferenceError('load your starter page', new Error('The signed-in account changed.'))
      }
      return parseStarterPage(starterPagesFromMetadata(data.user.user_metadata)[teamId])
    },
  })

/** Saves or clears the current user's starting page for one group in their account metadata. */
export async function saveStarterPagePreference(
  userId: string,
  teamId: string,
  preference: StarterPagePreference | null,
): Promise<StarterPagePreference | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw authPreferenceError('save your starter page', error)
  if (!data.user || data.user.id !== userId) {
    throw authPreferenceError('save your starter page', new Error('The signed-in account changed.'))
  }

  const metadata = objectValue(data.user.user_metadata) ?? {}
  const starterPages = starterPagesFromMetadata(metadata)
  if (sameStarterPage(parseStarterPage(starterPages[teamId]), preference)) return preference
  const nextStarterPages = { ...starterPages }
  if (preference) nextStarterPages[teamId] = preference
  else delete nextStarterPages[teamId]

  const { error: updateError } = await supabase.auth.updateUser({
    data: { ...metadata, [STARTER_PAGES_METADATA_KEY]: nextStarterPages },
  })
  if (updateError) throw authPreferenceError('save your starter page', updateError)
  return preference
}

/**
 * The session from this tab (or, when remembered, the browser), refreshed if expired. Good for deciding what
 * UI to show; it is not an authorization check. Postgres RLS is.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    logError('[auth] Failed to restore session', error)
    throw new AuthFlowError('session', { cause: error })
  }
  return data.session
}

export async function getCurrentUser(): Promise<User | null> {
  return (await getCurrentSession())?.user ?? null
}

/** Whether "Remember me" was ticked last time, to start the box that way. */
export function rememberedChoice(): boolean {
  return authStorage().remembered()
}

/**
 * The sign-in providers on /login. `azure` is Supabase's name for Microsoft (work, school and personal accounts).
 * GitHub shares the account's verified primary email, so it links to an existing account with that email.
 */
export type SignInProvider = 'google' | 'azure' | 'github'

/**
 * Starts the OAuth redirect to Google, Microsoft or GitHub. Resolves just before the browser leaves the page.
 * `remember` decides where the session will be kept (lib/auth-storage); it is set
 * before the redirect because the PKCE verifier is stored the same way.
 */
export async function signInWithProvider(provider: SignInProvider, next: string, remember: boolean): Promise<void> {
  await assertProviderEnabled(provider)
  rememberNextPath(next)
  authStorage().setRemembered(remember)

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // Fixed callback URL (must be in Supabase's Redirect URLs allow list);
      // the post-login destination travels in sessionStorage instead.
      redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
      // Microsoft sends the email only when asked for it; Calsko matches people by email.
      ...(provider === 'azure' ? { scopes: 'openid email profile' } : {}),
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) {
    logError('[auth] signInWithOAuth failed', error)
    throw new AuthFlowError('oauth', { cause: error })
  }
}

/**
 * Signs in with Google again, this time also asking for Google Calendar
 * (calendar.events), and comes back to `next`. The callback keeps the Google
 * token for this tab (captureCalendarToken). Google shows the consent screen
 * the first time only; `email` pre-selects the signed-in account.
 */
export async function connectGoogleCalendar(next: string, email: string | undefined): Promise<void> {
  rememberNextPath(next)
  markCalendarConnecting()
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
      scopes: CALENDAR_SCOPE,
      queryParams: { include_granted_scopes: 'true', ...(email ? { login_hint: email } : {}) },
    },
  })
  if (error) {
    clearCalendarToken()
    logError('[auth] connectGoogleCalendar failed', error)
    throw new AuthFlowError('oauth', { cause: error })
  }
}

/**
 * Email + password, for the admin account only (/admin-login). Everyone else
 * signs in with Google. The account is created in the Supabase dashboard; there
 * is no sign-up or password reset in the app. What it can see is decided by its
 * group and workspace roles under RLS, like any other user.
 */
export async function signInWithPassword(email: string, password: string, remember: boolean): Promise<void> {
  authStorage().setRemembered(remember)
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) {
    console.error('[auth] signInWithPassword failed', error)
    // A wrong password, an unknown email and a disabled provider all answer 400; network trouble has no status.
    throw new AuthFlowError(error.status === undefined || error.status >= 500 ? 'unavailable' : 'credentials', { cause: error })
  }
  startActivityClock()
  startSessionClock()
  saveMyTimeZone()
}

/** Signs out this browser only. Other devices keep their sessions. */
export async function signOut(): Promise<void> {
  clearCalendarToken()
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    logError('[auth] signOut failed', error)
    throw new Error('Couldn’t sign out. Check your connection and try again.', { cause: error })
  }
  clearActivityClock()
  clearSessionClock()
}

/** The session has passed its time limit (lib/auth-storage): sign out as usual. */
export function signOutForSessionLimit(): Promise<void> {
  limitSignOut ??= signOut().finally(() => {
    limitSignOut = null
  })
  return limitSignOut
}

let limitSignOut: Promise<void> | null = null

/**
 * The same sign-out, started by the inactivity clock (lib/inactivity) instead of
 * the person. It leaves a note for this browser's other tabs, which follow through
 * the auth change and tell the login page why.
 */
export function signOutForInactivity(): Promise<void> {
  // Loaders that run side by side each notice the expired clock: they share one request.
  idleSignOut ??= (async () => {
    markIdleSignOut()
    await signOut()
  })().finally(() => {
    idleSignOut = null
  })
  return idleSignOut
}

let idleSignOut: Promise<void> | null = null

/**
 * The signed-in user's profile row, or null if the sign-up trigger hasn't
 * created it (shouldn't happen, but the UI falls back to Google account data).
 * RLS limits this query to the caller's own row regardless of `userId`.
 */
export async function getCurrentProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    logError('[auth] Failed to load profile', error)
    throw new Error('Couldn’t load your profile.', { cause: error })
  }
  return data
}

export const profileQuery = (userId: string) =>
  queryOptions({
    queryKey: ['auth', 'profile', userId],
    queryFn: () => getCurrentProfile(userId),
    // Your own name and photo: nothing in the app changes them, so don't re-request them on every return to the tab.
    staleTime: SETTLED_STALE_MS,
    retry: 1,
  })

/**
 * If a provider is disabled, Supabase answers the OAuth redirect with a
 * raw JSON error page. Check the public auth settings first so we can show a
 * readable message instead.
 */
async function assertProviderEnabled(provider: SignInProvider): Promise<void> {
  let settings: unknown
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    settings = await response.json()
  } catch (error) {
    logError('[auth] Could not read auth settings', error)
    throw new AuthFlowError('unavailable', { cause: error })
  }

  const external =
    typeof settings === 'object' && settings !== null && 'external' in settings
      ? settings.external
      : null
  const enabled =
    typeof external === 'object' && external !== null && provider in external && (external as Record<string, unknown>)[provider] === true
  if (!enabled) throw new AuthFlowError('not-configured')
}
