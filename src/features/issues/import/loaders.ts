import type { LoaderFunctionArgs } from 'react-router'
import { requireUser } from '@/features/auth/loaders'
import { errorSourcesQuery } from '@/features/errors/queries'
import { myTeamsQuery } from '@/features/teams/api'
import { workspaceMembersQuery, workspaceQuery } from '@/features/workspaces/api'
import { queryClient } from '@/lib/query-client'
import { labelsQuery } from '../api'
import { issuesLoader } from '../loaders'
import { importPeopleQuery } from './api'

/**
 * …/w/:id/settings: with Issues on, the Issues and Import sections read the labels, who imported
 * names are mapped to, and the project's people; Error tracking (when the group has it) its sources. Started together here, not one per section.
 */
export async function workspaceSettingsLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const workspaceId = params.workspaceId ?? ''
  const [workspace, memberships] = await Promise.all([
    queryClient.ensureQueryData(workspaceQuery(workspaceId)),
    queryClient.ensureQueryData(myTeamsQuery(user.id)),
  ])
  if (!workspace?.modules.includes('issues')) return null
  const errorTracking = memberships.find((m) => m.team.slug === params.teamSlug)?.features.includes('error_tracking')
  await Promise.all([
    queryClient.prefetchQuery(labelsQuery(workspaceId)),
    queryClient.prefetchQuery(importPeopleQuery(workspaceId)),
    queryClient.prefetchQuery(workspaceMembersQuery(workspaceId)),
    // Error tracking's section: only in groups that have it.
    errorTracking && queryClient.prefetchQuery(errorSourcesQuery(workspaceId)),
  ])
  return null
}

/** …/w/:id/settings/import: everything the Issues pages load, plus the earlier mappings, side by side. */
export async function issueImportLoader(args: LoaderFunctionArgs) {
  await Promise.all([issuesLoader(args), queryClient.prefetchQuery(importPeopleQuery(args.params.workspaceId ?? ''))])
  return null
}
