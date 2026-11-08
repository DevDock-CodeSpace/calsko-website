import { useSuspenseQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/hooks'
import { useCollectionView } from '@/features/collections/hooks'
import { useCurrentTeam } from '@/features/teams/hooks'
import { workspacePermissions } from '@/features/teams/permissions'
import { myWorkspaceRolesQuery, teamCollectionsQuery } from '@/features/workspaces/api'

export type HubProject = {
  id: string
  title: string
  issue_key: string
  /** A lead here, or a group owner/admin. */
  canManage: boolean
  /** In the project, so its issues can be assigned to you (private.has_workspace_access). */
  canTake: boolean
}

/**
 * The projects the hub works with: those in the collection view that use Issues, with whether the
 * caller manages each and can be assigned its issues (UI only; RLS and check_issue decide). Read
 * from the shell's cache: no request.
 */
export function useHubProjects(): HubProject[] {
  const { user } = useAuth()
  const { team, role } = useCurrentTeam()
  const { workspaces } = useCollectionView()
  const roles = useSuspenseQuery(myWorkspaceRolesQuery(team.id, user.id)).data
  const collections = useSuspenseQuery(teamCollectionsQuery(team.id)).data
  // Mirrors private.has_workspace_access: added by name, or let in by the project's access setting.
  // Group owners/admins see every project but are only assignable where one of these holds.
  const inProject = (w: (typeof workspaces)[number]) =>
    roles[w.id] !== undefined ||
    w.access === 'group' ||
    (w.access === 'collection' && collections.some((c) => c.id === w.collection_id && c.memberIds.includes(user.id)))
  return workspaces
    .filter((w) => w.modules.includes('issues'))
    .map((w) => ({ id: w.id, title: w.title, issue_key: w.issue_key, canManage: workspacePermissions(role, roles[w.id]).canEdit, canTake: inProject(w) }))
    .sort((a, b) => a.title.localeCompare(b.title))
}
