// error-sync: the daily error-tracking run (docs/ERROR_TRACKING.md).
//
// Called two ways:
//   - by pg_cron once a day (private.kick_error_sync, through pg_net) with header x-worker-secret:
//     every enabled source in groups with error tracking on;
//   - by a project manager's "Sync now" (their Supabase token, body { source_id }): that one source,
//     at most once every 10 minutes (public.request_error_sync checks both, as the person).
//
// For each source: pull the errors since the last sync (pulled providers), record them, then write the
// issues for errors that need one (at most 20 per source per run; AI when error_tracking_ai is on).
//
// Secrets: ERROR_SYNC_SECRET (= the Vault secret 'error_sync_url'/'error_sync_secret' pair's secret),
// GEMINI_API_KEY and the other ai-agent provider secrets for AI-written issues.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createProvider } from '../ai-agent/providers/index.ts'
import type { AiProvider } from '../ai-agent/agent/types.ts'
import { aiIssue, type NewError, templateIssue } from '../_shared/error-tracking/describe.ts'
import { PROVIDERS } from '../_shared/error-tracking/providers/index.ts'
import { type ErrorReport, SourceProblem } from '../_shared/error-tracking/types.ts'
import { startErrorReporting } from '../_shared/report-errors.ts'

startErrorReporting('error-sync')

const ISSUES_PER_RUN = 20
const FIRST_SYNC_DAYS = 7
const AI_CONCURRENCY = 4
const RECORD_CHUNK = 500

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type DueSource = {
  id: string
  team_id: string
  workspace_id: string
  provider: string
  name: string
  config: Record<string, unknown>
  last_synced_at: string | null
  ai: boolean
  issue_key: string
}

type Pending = {
  id: string
  title: string
  raw: string
  url: string | null
  first_seen: string
  last_seen: string
  total_count: number
  previous_issue_number: number | null
}

export type SourceResult = { source: string; ok: boolean; errors: number; issues: number; message: string }

/** Runs `work` over `items`, at most `limit` at a time, in order of completion. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index])
      }
    }),
  )
  return results
}

async function record(admin: SupabaseClient, sourceId: string, reports: ErrorReport[]) {
  for (let i = 0; i < reports.length; i += RECORD_CHUNK) {
    const chunk = reports.slice(i, i + RECORD_CHUNK).map((r) => ({
      fingerprint: r.fingerprint,
      title: r.title,
      raw: r.raw,
      url: r.url ?? null,
      first_seen: r.firstSeen ?? null,
      last_seen: r.lastSeen ?? null,
      days: r.days,
      days_mode: r.daysMode ?? 'add',
      total: r.total ?? null,
    }))
    const { error } = await admin.rpc('error_record', { p_source: sourceId, p_reports: chunk })
    if (error) throw new Error(`error_record failed: ${error.message}`)
  }
}

async function writeIssues(admin: SupabaseClient, source: DueSource, ai: AiProvider | null): Promise<number> {
  const { data, error } = await admin.rpc('error_groups_needing_issues', { p_source: source.id, p_limit: ISSUES_PER_RUN })
  if (error) throw new Error(`error_groups_needing_issues failed: ${error.message}`)
  const pending = (data ?? []) as Pending[]
  const label = PROVIDERS[source.provider]?.label ?? 'the error tracker'

  const made = await pool(pending, AI_CONCURRENCY, async (group) => {
    const newError: NewError = {
      title: group.title,
      raw: group.raw,
      url: group.url,
      firstSeen: group.first_seen,
      lastSeen: group.last_seen,
      totalCount: Number(group.total_count),
      cameBackAfter: group.previous_issue_number ? `${source.issue_key}-${group.previous_issue_number}` : null,
    }
    let written = null
    if (ai) {
      try {
        written = await aiIssue(ai, newError, label)
      } catch (e) {
        // A failed AI call never loses the error: the plain template is used instead.
        console.warn('[error-sync] AI failed, using the template', e instanceof Error ? e.message : e)
      }
    }
    written ??= templateIssue(newError, label, source.name)
    const { error: createError } = await admin.rpc('error_create_issue', {
      p_group: group.id,
      p_title: written.title,
      p_description: written.description,
      p_priority: written.priority,
    })
    if (createError) {
      console.error('[error-sync] error_create_issue failed', createError)
      return 0
    }
    return 1
  })
  return made.reduce<number>((sum, n) => sum + n, 0)
}

async function syncSource(admin: SupabaseClient, source: DueSource, ai: AiProvider | null): Promise<SourceResult> {
  const provider = PROVIDERS[source.provider]
  const until = new Date()
  let errors = 0
  try {
    if (!provider) throw new SourceProblem('This kind of source is not supported any more.')
    if (provider.pull) {
      const { data: apiKey, error: keyError } = await admin.rpc('error_source_api_key', { p_source: source.id })
      if (keyError) throw new Error(`error_source_api_key failed: ${keyError.message}`)
      if (!apiKey) throw new SourceProblem('The API key is missing. Add it again in the source\'s settings.')
      const since = source.last_synced_at ? new Date(source.last_synced_at) : new Date(until.getTime() - FIRST_SYNC_DAYS * 86_400_000)
      const reports = await provider.pull({ config: source.config, apiKey: apiKey as string, since, until, fetch })
      errors = reports.length
      await record(admin, source.id, reports)
    }
    const issues = await writeIssues(admin, source, ai)
    const message = provider.pull
      ? `${errors} ${errors === 1 ? 'kind of error' : 'kinds of error'} since the last sync, ${issues} new ${issues === 1 ? 'issue' : 'issues'}`
      : `${issues} new ${issues === 1 ? 'issue' : 'issues'} from webhook reports`
    await admin.rpc('error_finish_sync', { p_source: source.id, p_ok: true, p_message: message, p_synced_until: until.toISOString() })
    return { source: source.id, ok: true, errors, issues, message }
  } catch (e) {
    const known = e instanceof SourceProblem
    if (!known) console.error('[error-sync] source failed', source.id, e)
    const message = known ? e.message : 'The sync failed. It will try again tomorrow.'
    await admin.rpc('error_finish_sync', { p_source: source.id, p_ok: false, p_message: message, p_synced_until: null })
    return { source: source.id, ok: false, errors, issues: 0, message }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let only: string | null = null
  const workerSecret = Deno.env.get('ERROR_SYNC_SECRET')
  const fromCron = !!workerSecret && sameSecret(req.headers.get('x-worker-secret') ?? '', workerSecret)
  if (!fromCron) {
    // "Sync now": the person must manage the source's project (checked as them, in the database).
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    let body: { source_id?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    if (!token || typeof body.source_id !== 'string') return json({ error: 'unauthorized' }, 401)
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await asUser.rpc('request_error_sync', { p_source_id: body.source_id })
    if (error) {
      if (error.code === 'DD010') return json({ error: 'too_soon', message: error.message }, 429)
      return json({ error: 'forbidden' }, 403)
    }
    only = body.source_id
  }

  const { data, error } = await admin.rpc('error_sources_due', only ? { p_source: only } : {})
  if (error) {
    console.error('[error-sync] error_sources_due failed', error)
    return json({ error: 'failed' }, 500)
  }
  const sources = (data ?? []) as DueSource[]
  const provider = createProvider((name) => Deno.env.get(name))

  const results: SourceResult[] = []
  for (const source of sources) {
    results.push(await syncSource(admin, source, source.ai ? provider : null))
  }
  return json(only ? (results[0] ?? { ok: false, message: 'This source is switched off.' }) : { sources: results.length, results })
})
