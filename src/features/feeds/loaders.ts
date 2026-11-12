import type { LoaderFunctionArgs } from 'react-router'
import { requireUser } from '@/features/auth/loaders'
import { teamConversationsQuery } from '@/features/messaging/api'
import { myTeamsQuery } from '@/features/teams/api'
import { teamPermissions } from '@/features/teams/permissions'
import { queryClient } from '@/lib/query-client'
import { chatFeedsQuery } from './queries'

/** /t/:slug/settings: Chat feeds' section (flag on, owners and admins) reads its feeds and the channels, started with the page. */
export async function teamSettingsLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const memberships = await queryClient.ensureQueryData(myTeamsQuery(user.id))
  const membership = memberships.find((m) => m.team.slug === params.teamSlug)
  if (membership?.features.includes('chat_feeds') && teamPermissions(membership.role).isAdmin) {
    await Promise.all([
      queryClient.prefetchQuery(chatFeedsQuery(membership.team.id)),
      queryClient.prefetchQuery(teamConversationsQuery(membership.team.id)),
    ])
  }
  return null
}
