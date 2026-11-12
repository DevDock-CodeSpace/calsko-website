import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PersonRow } from '@/components/PersonRow'
import { useAuth } from '@/features/auth/hooks'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { issuesPath, teamPath } from '@/features/teams/nav'
import { personHref } from '@/features/issues/views'
import { workspaceRoleLabel } from '@/features/teams/permissions'
import { accessLabel } from '@/features/workspaces/access'
import {
  addWorkspaceMember,
  removeWorkspaceMember,
  setWorkspaceRole,
  teamCollectionsQuery,
  workspaceMembersQuery,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@/features/workspaces/api'
import { AddWorkspaceMembersDialog } from '@/features/workspaces/components/AddWorkspaceMembersDialog'
import { errorMessage } from '@/lib/errors'
import { courseEnrollmentPanel } from '@/features/learning/screens'

export function WorkspaceMembersPage() {
  const { user } = useAuth()
  const { team } = useCurrentTeam()
  const { workspace, can } = useCurrentWorkspace()
  const [{ data: people }, { data: collections }] = useSuspenseQueries({
    queries: [workspaceMembersQuery(workspace.id), teamCollectionsQuery(team.id)],
  })
  // The people added to it, then (for an open workspace) everyone its access setting lets in.
  const members = people.filter((p) => p.via === 'member')
  const others = people.filter((p) => p.via !== 'member')
  const collection = collections.find((c) => c.id === workspace.collection_id)
  const canAssignDeveloper =
    team.type !== 'learning' && workspace.type === 'general' && collection?.type === 'development'
  const stillOpenTo = (userId: string) =>
    workspace.access === 'group' || (workspace.access === 'collection' && !!collection?.memberIds.includes(userId))
  const openTo = accessLabel(workspace.access, collection)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null)

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceMembersQuery(workspace.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: ['workspaces', 'team', team.id] }),
    ])

  const changeRole = useMutation({
    mutationFn: (vars: { userId: string; role: WorkspaceRole }) => setWorkspaceRole(workspace.id, vars.userId, vars.role),
    onSuccess: (_, vars) => {
      toast.success(`Role changed to ${workspaceRoleLabel[vars.role]}`)
      return refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  // Someone let in by the access setting has no row to change, so leading starts by adding them.
  const makeLead = useMutation({
    mutationFn: (userId: string) => addWorkspaceMember(workspace.id, userId, 'lead'),
    onSuccess: () => {
      toast.success(`Role changed to ${workspaceRoleLabel.lead}`)
      return refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(workspace.id, userId),
    onSuccess: async (_, userId) => {
      setRemoving(null)
      if (userId === user.id && !can.canDelete && !stillOpenTo(user.id)) {
        // Left the workspace and (not being a team admin, and it not being open to them) can no longer see it.
        toast.success(`You left ${workspace.title}`)
        await navigate(teamPath(team.slug), { replace: true })
        queryClient.removeQueries({ queryKey: ['workspaces', workspace.id] })
        await queryClient.invalidateQueries({ queryKey: ['workspaces', 'team', team.id] })
        return
      }
      toast.success('Removed from workspace')
      await refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const isCourse = workspace.type === 'course'
  return (
    <>
      {isCourse && can.canEdit && (
        <Suspense fallback={<div className="mb-10 h-40 animate-pulse rounded-lg bg-muted" />}>
          <courseEnrollmentPanel.Component />
        </Suspense>
      )}
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{isCourse ? 'Teachers and students' : 'Members'}</h2>
          <p className="text-sm text-muted-foreground">
            {people.length} {people.length === 1 ? 'person' : 'people'}.{' '}
            {isCourse
              ? 'Leads teach the course; members are its students.'
              : canAssignDeveloper
                ? 'Leads manage the space; developers can schedule its meetings; members use it.'
                : 'Leads manage the workspace; members use it.'}
            {workspace.access !== 'members' && ` Open to: ${openTo.toLowerCase()}.`}
          </p>
        </div>
        {can.canAddMembers && <AddWorkspaceMembersDialog />}
      </div>

      {people.length === 0 ? (
        <p className="border-y py-10 text-center text-sm text-muted-foreground">
          Nobody has been added to this workspace yet.
        </p>
      ) : members.length === 0 ? (
        <p className="border-y py-6 text-center text-sm text-muted-foreground">Nobody has been added by name.</p>
      ) : (
        <ul className="divide-y border-y">
          {members.map((member) => {
            const isYou = member.user_id === user.id
            const canChangeRole = can.canAssignLeads
            const canRemove = !isYou && can.canRemove(member.role)
            const canLeave = isYou
            const roleChoices: WorkspaceRole[] =
              member.role === 'lead'
                ? ['member', ...(canAssignDeveloper ? ['developer' as const] : [])]
                : member.role === 'developer'
                  ? ['member', 'lead']
                  : ['lead', ...(canAssignDeveloper ? ['developer' as const] : [])]
            return (
              <PersonRow
                key={member.user_id}
                profile={member.profile}
                userId={member.user_id}
                isYou={isYou}
                role={workspaceRoleLabel[member.role]}
                highlight={member.role === 'lead'}
                meta={
                  workspace.modules.includes('issues') ? (
                    <Link to={personHref(issuesPath(team.slug, workspace.id), member.user_id)} className="font-sans text-xs text-brand hover:underline">
                      Issues
                    </Link>
                  ) : undefined
                }
                actions={
                  (canChangeRole || canRemove || canLeave) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.profile?.display_name ?? 'member'}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canChangeRole && (
                          roleChoices
                            .filter((next) => next !== member.role)
                            .map((next) => (
                              <DropdownMenuItem
                                key={next}
                                onSelect={() => changeRole.mutate({ userId: member.user_id, role: next })}
                              >
                                Make {workspaceRoleLabel[next].toLowerCase()}
                              </DropdownMenuItem>
                            ))
                        )}
                        {canChangeRole && (canRemove || canLeave) && <DropdownMenuSeparator />}
                        {(canRemove || canLeave) && (
                          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(member)}>
                            {isYou ? 'Leave workspace' : 'Remove from workspace'}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                }
              />
            )
          })}
        </ul>
      )}

      {others.length > 0 && (
        <section aria-labelledby="open-to" className="mt-8">
          <h3 id="open-to" className="text-sm font-semibold">
            {openTo}
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">
            {others.length} more {others.length === 1 ? 'person has' : 'people have'} access without being added. They
            work as members.
          </p>
          <ul className="divide-y border-y">
            {others.map((person) => (
              <PersonRow
                key={person.user_id}
                profile={person.profile}
                userId={person.user_id}
                isYou={person.user_id === user.id}
                role={workspaceRoleLabel.member}
                actions={
                  can.canAssignLeads && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${person.profile?.display_name ?? 'member'}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => makeLead.mutate(person.user_id)}>Make lead</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.user_id === user.id ? 'Leave this workspace?' : 'Remove from workspace?'}
        description={
          removing?.user_id === user.id
            ? workspace.access === 'members'
              ? `You’ll lose access to ${workspace.title} unless someone adds you again.`
              : `You’ll no longer be listed by name in ${workspace.title}. You keep access if it stays open to you.`
            : workspace.access === 'members'
              ? `${removing?.profile?.display_name ?? 'This person'} will lose access to ${workspace.title}. They stay in the group.`
              : `${removing?.profile?.display_name ?? 'This person'} will no longer be listed by name. They keep access if ${workspace.title} stays open to them.`
        }
        confirmLabel={removing?.user_id === user.id ? 'Leave' : 'Remove'}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.user_id)}
      />
    </>
  )
}
