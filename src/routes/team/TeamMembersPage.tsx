import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { Suspense, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/hooks'
import { PersonRow } from '@/components/PersonRow'
import { removeTeamMember, setTeamRole, teamMembersQuery, type TeamMember, type TeamRole } from '@/features/teams/api'
import { InvitesPanel } from '@/features/teams/components/InvitesPanel'
import { roleGuide } from '@/features/teams/screens'
import { useCurrentTeam } from '@/features/teams/hooks'
import { teamRoleName } from '@/features/teams/permissions'
import { errorMessage } from '@/lib/errors'

const joinedFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function TeamMembersPage() {
  const { user } = useAuth()
  const { team, role, can } = useCurrentTeam()
  const members = useSuspenseQuery(teamMembersQuery(team.id)).data
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<TeamMember | null>(null)

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: teamMembersQuery(team.id).queryKey }),
      // Removing someone also removes their workspace memberships.
      queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
    ])

  const changeRole = useMutation({
    mutationFn: (vars: { userId: string; role: Exclude<TeamRole, 'owner'> }) => setTeamRole(team.id, vars.userId, vars.role),
    onSuccess: (_, vars) => {
      toast.success(`Role changed to ${teamRoleName(vars.role, team.type)}`)
      return refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (userId: string) => removeTeamMember(team.id, userId),
    onSuccess: () => {
      toast.success('Member removed')
      setRemoving(null)
      return refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <>
      <PageHeader
        title="Group members"
        description={`${members.length} ${members.length === 1 ? 'person' : 'people'} in ${team.name}. Each course, project or space decides who sees it.`}
      />

      <ul className="-mt-6 divide-y border-b">
        {members.map((member) => {
          const isYou = member.user_id === user.id
          // The owner sets any role; admins switch members and teachers.
          const roleChoices: Exclude<TeamRole, 'owner'>[] =
            isYou || member.role === 'owner'
              ? []
              : can.canChangeRoles
                ? (['admin', 'teacher', 'member'] as const).filter((r) => r !== member.role)
                : can.canSetTeachers && (member.role === 'member' || member.role === 'teacher')
                  ? [member.role === 'member' ? 'teacher' : 'member']
                  : []
          const canChangeRole = roleChoices.length > 0
          const canRemove = !isYou && can.canRemove(member.role)
          return (
            <PersonRow
              key={member.user_id}
              profile={member.profile}
              userId={member.user_id}
              isYou={isYou}
              role={teamRoleName(member.role, team.type)}
              highlight={member.role === 'owner' || member.role === 'teacher'}
              meta={`joined ${joinedFormat.format(new Date(member.joined_at))}`}
              actions={
                (canChangeRole || canRemove) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.profile?.display_name ?? 'member'}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {roleChoices.map((next) => (
                        <DropdownMenuItem key={next} onSelect={() => changeRole.mutate({ userId: member.user_id, role: next })}>
                          Make {teamRoleName(next, team.type).toLowerCase()}
                        </DropdownMenuItem>
                      ))}
                      {canChangeRole && canRemove && <DropdownMenuSeparator />}
                      {canRemove && (
                        <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(member)}>
                          Remove from group
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

      {can.canInvite && <InvitesPanel />}

      <Suspense fallback={null}>
        <roleGuide.Component type={team.type} myRole={role} />
      </Suspense>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove member?"
        description={
          <>
            {removing?.profile?.display_name ?? 'This person'} will lose access to {team.name} and every workspace in
            it. You can invite them again later.
          </>
        }
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.user_id)}
      />
    </>
  )
}
