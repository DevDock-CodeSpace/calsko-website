import { FunctionsHttpError } from '@supabase/supabase-js'
import { DataError, requireAffected, toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database.types'
import type { ErrorProviderId, ErrorSource } from './queries'

// Error tracking (docs/ERROR_TRACKING.md): error trackers connected to a project, whose errors become
// counted issues once a day. Project managers connect sources (Project settings → Error tracking); the
// error-sync and error-intake Edge Functions and the error_* database functions do the rest. Secrets
// (API keys, webhook tokens) are written once and never read back.

export { errorKeys, errorSourcesQuery, type ErrorProviderId, type ErrorSource } from './queries'

/** The database's own messages for bad input are written for people; show them as they are. */
const passMessage = (error: { code?: string; message: string }) => ({ '22023': error.message })

/** Connects a source. Returns the webhook token (shown once) for webhook sources. */
export async function createErrorSource(input: {
  workspaceId: string
  provider: ErrorProviderId
  name: string
  config: Record<string, string>
  apiKey?: string
}): Promise<{ id: string; token: string | null }> {
  const { data, error } = await supabase.rpc('create_error_source', {
    p_workspace_id: input.workspaceId,
    p_provider: input.provider,
    p_name: input.name,
    p_config: input.config as Json,
    p_api_key: input.apiKey ?? undefined,
  })
  if (error) throw toDataError('connect the error tracker', error, passMessage(error))
  return data as { id: string; token: string | null }
}

export async function updateErrorSource(id: string, patch: Partial<Pick<ErrorSource, 'name' | 'enabled' | 'label_id'>>) {
  const { data, error } = await supabase.from('error_sources').update(patch).eq('id', id).select('id')
  if (error) throw toDataError('update the error source', error)
  requireAffected(data, 'update error source')
}

export async function updateErrorSourceConnection(id: string, config: Record<string, string>, apiKey?: string) {
  const { error } = await supabase.rpc('update_error_source_connection', {
    p_source_id: id,
    p_config: config as Json,
    p_api_key: apiKey || undefined,
  })
  if (error) throw toDataError('update the connection', error, passMessage(error))
}

/** The plan new issues go into (null = none); `includeExisting` also moves its open issues without a plan. */
export async function setErrorSourcePlan(id: string, planId: string | null, includeExisting: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('set_error_source_plan', {
    p_source_id: id,
    // null clears the plan; the generated types don't know the argument may be null.
    p_plan_id: planId as string,
    p_include_existing: includeExisting,
  })
  if (error) throw toDataError('choose the plan', error)
  return data
}

export async function rotateErrorSourceToken(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_error_source_token', { p_source_id: id })
  if (error) throw toDataError('make a new token', error)
  return data
}

export async function deleteErrorSource(id: string) {
  const { data, error } = await supabase.from('error_sources').delete().eq('id', id).select('id')
  if (error) throw toDataError('remove the error source', error)
  requireAffected(data, 'delete error source')
}

export type SyncResult = { ok: boolean; errors: number; issues: number; message: string }

/** "Sync now": the daily run for one source, as the person (at most every 10 minutes). */
export async function syncErrorSource(id: string): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke<SyncResult>('error-sync', { body: { source_id: id } })
  if (error || !data) {
    let body: { error?: string; message?: string } | undefined
    if (error instanceof FunctionsHttpError) body = await (error.context as Response).json().catch(() => undefined)
    if (body?.error === 'too_soon') throw new DataError(body.message ?? 'Synced a moment ago. Try again in a few minutes.', 'too_soon')
    console.error('[errors] sync failed', body?.error ?? error)
    throw new DataError(body?.error === 'forbidden' ? 'Only the project’s leads and group admins can sync.' : 'The sync failed. Please try again.', body?.error)
  }
  return data
}

/** Where a webhook source receives errors. The token goes in the x-calsko-token header. */
export function webhookUrl(sourceId: string): string {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/functions/v1/error-intake?source=${sourceId}`
}
