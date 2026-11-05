// Where to send the user after sign-in. Only same-origin app paths are allowed,
// so a crafted ?next= can't turn Calsko into an open redirect.

import { myTeamsQuery } from '@/features/teams/api'
import { queryClient } from '@/lib/query-client'

const NEXT_KEY = 'devdock:auth-next'
export const DEFAULT_AFTER_LOGIN = '/app'

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_AFTER_LOGIN
  }
  if (value.startsWith('/login') || value.startsWith('/auth/')) return DEFAULT_AFTER_LOGIN
  return value
}

/** Survives the round trip to Google (same tab), so redirectTo can stay a fixed URL. */
export function rememberNextPath(next: string) {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNextPath(next))
  } catch {
    // Storage blocked: the user lands on the default page instead.
  }
}

export function takeNextPath(): string {
  try {
    const next = sessionStorage.getItem(NEXT_KEY)
    sessionStorage.removeItem(NEXT_KEY)
    return safeNextPath(next)
  } catch {
    return DEFAULT_AFTER_LOGIN
  }
}

/**
 * `next` for the person who just signed in. It is often the page open when the browser was signed
 * out (idle, or the session limit), which may have been another account's: signed out as one person,
 * signed in as another, it opened a group they aren't in ("Group not found"). A group page of a
 * group they aren't in opens their own instead. Reads the memberships the next page loads anyway.
 */
export async function nextForUser(next: string, userId: string): Promise<string> {
  const slug = /^\/t\/([^/?#]+)/.exec(next)?.[1]
  if (!slug) return next
  // Signing in clears the cache, which cancels a fetch already running: ask once more. Still unknown
  // (offline): /app opens a group they're in.
  const fetch = () => queryClient.fetchQuery(myTeamsQuery(userId))
  const memberships = await fetch()
    .catch(fetch)
    .catch(() => null)
  return memberships?.some((m) => m.team.slug === slug) ? next : DEFAULT_AFTER_LOGIN
}
