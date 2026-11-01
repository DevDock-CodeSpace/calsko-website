import type { LoaderFunctionArgs } from 'react-router'
import { requireUser } from '@/features/auth/loaders'
import { myTeamsQuery } from '@/features/teams/api'
import { queryClient } from '@/lib/query-client'
import { learningOverviewQuery } from './platformQueries'

/** /t/:teamSlug/learning: everything the page shows comes from one call, started with the page's code. */
export async function teamLearningLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const memberships = await queryClient.ensureQueryData(myTeamsQuery(user.id))
  const team = memberships.find((m) => m.team.slug === params.teamSlug)?.team
  if (team) void queryClient.prefetchQuery(learningOverviewQuery(team.id))
  return null
}
