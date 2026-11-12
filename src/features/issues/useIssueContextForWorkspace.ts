import { useSuspenseQueries } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/hooks'
import { teamPlansQuery } from '@/features/plans/api'
import { workspaceReposQuery } from '@/features/repos/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { workspaceMembersQuery } from '@/features/workspaces/api'
import { cyclesQuery, labelsQuery } from './api'
import type { HubProject } from './hub/hooks'

/** Issue-form context for a project chosen from outside its workspace route. */
export function useIssueContextForWorkspace(project: Pick<HubProject, 'id' | 'title' | 'issue_key' | 'canManage'>) {
  const { user } = useAuth()
  const { team } = useCurrentTeam()
  const [{ data: members }, { data: labels }, { data: cycles }, { data: repos }, { data: plans }] = useSuspenseQueries({
    queries: [
      workspaceMembersQuery(project.id),
      labelsQuery(project.id),
      cyclesQuery(project.id),
      workspaceReposQuery(project.id),
      teamPlansQuery(team.id),
    ],
  })
  return {
    workspace: project,
    members,
    labels,
    cycles,
    repos,
    plans,
    canManage: project.canManage,
    userId: user.id,
  }
}
