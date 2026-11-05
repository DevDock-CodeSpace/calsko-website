// PostHog: errors and page views. No clicks, session replay, surveys or feature flags.
//
// This file is on the first load and stays tiny. posthog-js (about 100 KB gzipped, its own chunk, cached by the
// browser) loads in the background once the first screen has painted (owner's choice, 2026-10-30), or sooner if
// an error happens first: errors wait in a short queue until it has loaded. Nothing is sent, and the library is
// never downloaded, unless POSTHOG_KEY is set and this is a production build.
//
// Page views: one $pageview per route change (PostHog follows history changes) and a $pageleave, for PostHog's
// Web analytics. Errors: uncaught errors and promise rejections, route errors (RouteErrorPage), React root
// errors, failed Supabase calls (`toDataError`) and `logError`. People are identified by user id only (no name
// or email).

import type { PostHog } from 'posthog-js'

type Pending = { error: unknown; properties: Record<string, unknown> }

const key = __POSTHOG_KEY__
const enabled = import.meta.env.PROD && Boolean(key)
const MAX_QUEUED = 20

let client: PostHog | null = null
let queue: Pending[] = []
let userId: string | null = null
let loading = false

/** Report an error. Safe to call anywhere, any number of times; does nothing when tracking is off. */
export function reportError(error: unknown, properties: Record<string, unknown> = {}): void {
  if (!enabled || isNoise(error)) return
  if (client) {
    client.captureException(error, properties)
    return
  }
  if (queue.length < MAX_QUEUED) queue.push({ error, properties })
  load()
}

/**
 * console.error plus a report, for failures the app catches and handles (shows a message, retries later).
 * The issue is the first Error among `details`, else the message; the message and other values go along
 * as `context` and `detail`, so one kind of failure stays one issue.
 */
export function logError(message: string, ...details: unknown[]): void {
  console.error(message, ...details)
  const error = details.find((d) => d instanceof Error)
  const others = details.filter((d) => d !== error)
  reportError(error ?? new Error(message), {
    source: 'caught',
    context: error ? message : undefined,
    detail: others.length ? describe(others) : undefined,
  })
}

/**
 * Not bugs, so not reported: the browser's ResizeObserver notice (harmless, and Chrome fires it on
 * ordinary layout changes) and requests that never reached a server (connection dropped, laptop asleep).
 */
export function isNoise(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /ResizeObserver loop|Failed to fetch|NetworkError when attempting|Load failed/i.test(text)
}

/** Whether someone is signed in, as far as error reports know (set by `watchAuthIdentity`). */
export const errorUserKnown = () => userId !== null

function describe(values: unknown[]): string {
  const text = values
    .map((v) => {
      try {
        return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
      } catch {
        return String(v)
      }
    })
    .join(' ')
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text
}

/** Who errors belong to (the signed-in user's id, or null after sign-out). Called by `watchAuthIdentity`. */
export function setErrorUser(id: string | null): void {
  if (id === userId) return
  userId = id
  if (!client) return
  if (id) client.identify(id)
  else client.reset()
}

/** Called once from main.tsx: reports uncaught errors and rejections, and loads PostHog after the first paint. */
export function startErrorTracking(): void {
  if (!enabled) return
  window.addEventListener('error', (event) => reportError(event.error ?? event.message, { source: 'window.onerror' }))
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason, { source: 'unhandledrejection' }))
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 5_000 })
  else setTimeout(load, 2_000)
}

function load(): void {
  if (loading) return
  loading = true
  // If the chunk can't load (offline), drop the queued errors and try again at the next error.
  loadPostHog().catch(() => {
    queue = []
    loading = false
  })
}

async function loadPostHog(): Promise<void> {
  const { posthog } = await import('posthog-js')
  posthog.init(key, {
    // Through our own domain (vercel.json forwards /_relay to us.i.posthog.com): ad blockers block PostHog's.
    api_host: '/_relay',
    ui_host: 'https://us.posthog.com',
    // Page views follow the router's history changes. Our own listeners above report uncaught errors, so
    // PostHog's exception autocapture stays off, and so does click autocapture.
    capture_pageview: 'history_change',
    capture_pageleave: true,
    capture_exceptions: false,
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    // No cookies or localStorage: PostHog's id and session live in the tab (sessionStorage), so reloads stay one
    // session. Starts as the signed-in user when that's already known; otherwise setErrorUser identifies them.
    // Signed out, visits are anonymous and make no person (identified_only).
    persistence: 'sessionStorage',
    ...(userId ? { bootstrap: { distinctID: userId, isIdentifiedID: true } } : {}),
    person_profiles: 'identified_only',
  })
  // Tells DevDock Dev's errors from live's in one PostHog project.
  posthog.register({ supabase_project: supabaseProject() })
  client = posthog
  const pending = queue
  queue = []
  for (const { error, properties } of pending) posthog.captureException(error, properties)
}

function supabaseProject(): string {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname.split('.')[0] || 'unknown'
  } catch {
    return 'unknown'
  }
}
