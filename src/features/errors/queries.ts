import { queryOptions } from '@tanstack/react-query'
import { toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// What the settings loader needs (it's in the first load through the router), apart from api.ts's
// mutations, which load with the settings page.

export type ErrorProviderId = 'posthog' | 'webhook'

export type ErrorSource = {
  id: string
  workspace_id: string
  provider: ErrorProviderId
  name: string
  config: { host?: string; project_id?: string }
  enabled: boolean
  label_id: string | null
  /** The plan new issues go into. */
  plan_id: string | null
  last_synced_at: string | null
  last_sync_ok: boolean | null
  last_sync_message: string | null
  created_at: string
}

export const errorKeys = {
  sources: (workspaceId: string) => ['errors', 'sources', workspaceId] as const,
}

const SOURCE_COLUMNS =
  'id, workspace_id, provider, name, config, enabled, label_id, plan_id, last_synced_at, last_sync_ok, last_sync_message, created_at'

/** The project's sources (managers only; others get an empty list from RLS). */
export const errorSourcesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: errorKeys.sources(workspaceId),
    queryFn: async (): Promise<ErrorSource[]> => {
      const { data, error } = await supabase
        .from('error_sources')
        .select(SOURCE_COLUMNS)
        .eq('workspace_id', workspaceId)
        .order('created_at')
      if (error) throw toDataError('load error sources', error)
      return data as ErrorSource[]
    },
  })
