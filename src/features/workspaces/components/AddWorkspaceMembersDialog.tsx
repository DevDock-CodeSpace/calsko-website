import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Check, LoaderCircle, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { teamMembersQuery } from '@/features/teams/api'
import { TeamInviteCode } from '@/features/teams/components/TeamInviteCode'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { addWorkspaceMember, teamCollectionsQuery, workspaceMembersQuery, type WorkspaceRole } from '../api'
import { errorMessage } from '@/lib/errors'
import { initials } from '@/lib/utils'

/** Add people who are already in the team to this workspace. */
export function AddWorkspaceMembersDialog() {
  const { team } = useCurrentTeam()
  const { workspace, can } = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [{ data: teamMembers }, { data: workspaceMembers }, { data: collections }] = useSuspenseQueries({
    queries: [
      teamMembersQuery(team.id),
      workspaceMembersQuery(workspace.id),
      teamCollectionsQuery(team.id),
    ],
  })
  const canAssignDeveloper =
    team.type !== 'learning' &&
    workspace.type === 'general' &&
    collections.some((collection) => collection.id === workspace.collection_id && collection.type === 'development')
  const [role, setRole] = useState<WorkspaceRole>('member')
  // People let in by the access setting can still be added, which gives them a row of their own.
  const inWorkspace = new Set(workspaceMembers.filter((m) => m.via === 'member').map((m) => m.user_id))
  const candidates = teamMembers.filter((m) => !inWorkspace.has(m.user_id))
  const roleToAdd =
    !can.canAssignLeads || (role === 'developer' && !canAssignDeveloper) ? 'member' : role

  const add = useMutation({
    mutationFn: (userId: string) => addWorkspaceMember(workspace.id, userId, roleToAdd),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceMembersQuery(workspace.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: ['workspaces', 'team', team.id] }),
      ]),
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Dialog
      onOpenChange={(open) => {
        // Pick up anyone who just joined the team with an invite code.
        if (open) void queryClient.invalidateQueries({ queryKey: teamMembersQuery(team.id).queryKey })
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus /> Add people
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add people to {workspace.title}</DialogTitle>
          <DialogDescription>
            Pick from people already in {team.name}. To bring in someone new, share the group invite code below.
          </DialogDescription>
        </DialogHeader>

        {can.canAssignLeads && (
          <div className="flex items-center gap-3">
            <Label className="shrink-0">Add as</Label>
            <Select value={role} onValueChange={(v) => setRole(v as WorkspaceRole)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                {canAssignDeveloper && <SelectItem value="developer">Developer</SelectItem>}
                <SelectItem value="lead">Lead</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Everyone in this group is already in the workspace.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {candidates.map((person) => {
              const name = person.profile?.display_name ?? 'Unnamed member'
              const adding = add.isPending && add.variables === person.user_id
              return (
                <li key={person.user_id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar className="size-8 rounded-md">
                    {person.profile?.avatar_url && (
                      <AvatarImage src={person.profile.avatar_url} alt="" referrerPolicy="no-referrer" />
                    )}
                    <AvatarFallback className="rounded-md text-xs">{initials(name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                  <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutate(person.user_id)}>
                    {adding ? <LoaderCircle className="animate-spin" /> : <Check />} Add
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <TeamInviteCode />
      </DialogContent>
    </Dialog>
  )
}
