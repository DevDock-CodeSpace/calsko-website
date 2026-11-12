import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/features/auth/hooks'
import {
  saveStarterPagePreference,
  starterPagePreferenceQuery,
  type StarterPagePreference,
} from '@/features/auth/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { hasTeamIssues } from '@/features/teams/nav'
import { teamWorkspacesQuery } from '@/features/workspaces/api'

type StarterPageChoice = 'automatic' | StarterPagePreference['type']
type Draft = { type: StarterPageChoice; workspaceId: string }

function isStarterPageChoice(value: string): value is StarterPageChoice {
  return ['automatic', 'chat', 'my-issues', 'project', 'course'].includes(value)
}

/** Per-account starting page for the current group; collection switches remain unchanged. */
export default function StarterPageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const { team } = useCurrentTeam()
  const queryClient = useQueryClient()
  const preference = useQuery(starterPagePreferenceQuery(user.id, team.id))
  const workspacesQuery = useQuery(teamWorkspacesQuery(team.id))
  const workspaces = workspacesQuery.data ?? []
  const projects = workspaces.filter((workspace) => workspace.type === 'project')
  const courses = workspaces.filter((workspace) => workspace.type === 'course' && workspace.modules.includes('learning'))
  const issuesAvailable = hasTeamIssues(team.type, workspaces)
  const [draft, setDraft] = useState<Draft | null>(null)
  const choice = draft?.type ?? preference.data?.type ?? 'automatic'
  const targets = choice === 'project' ? projects : choice === 'course' ? courses : []
  const savedWorkspaceId =
    preference.data && 'workspaceId' in preference.data && preference.data.type === choice
      ? preference.data.workspaceId
      : ''
  const candidateWorkspaceId = draft?.type === choice ? draft.workspaceId : savedWorkspaceId
  const workspaceId = targets.some((workspace) => workspace.id === candidateWorkspaceId)
    ? candidateWorkspaceId
    : (targets[0]?.id ?? '')

  const save = useMutation({
    mutationFn: (next: StarterPagePreference | null) => saveStarterPagePreference(user.id, team.id, next),
    onSuccess: async (next) => {
      queryClient.setQueryData(starterPagePreferenceQuery(user.id, team.id).queryKey, next)
      toast.success(next ? 'Starter page saved.' : 'Using the group default.')
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const selectChoice = (value: string) => {
    if (!isStarterPageChoice(value)) return
    const firstTarget = value === 'project' ? projects[0]?.id : value === 'course' ? courses[0]?.id : undefined
    setDraft({ type: value, workspaceId: firstTarget ?? '' })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (choice === 'automatic') save.mutate(null)
    else if (choice === 'chat' || choice === 'my-issues') save.mutate({ type: choice })
    else if (workspaceId) save.mutate({ type: choice, workspaceId })
  }

  const loading = preference.isPending || workspacesQuery.isPending
  const unavailable = preference.isError || workspacesQuery.isError
  const canSave =
    !loading &&
    !unavailable &&
    !save.isPending &&
    (choice !== 'my-issues' || issuesAvailable) &&
    (choice !== 'project' || projects.length > 0) &&
    (choice !== 'course' || courses.length > 0) &&
    (!['project', 'course'].includes(choice) || Boolean(workspaceId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Choose a starter page</DialogTitle>
            <DialogDescription>
              Choose where this group opens after sign-in or when you switch groups. This setting is saved to your
              account; collection switches keep their current behavior.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" />
              Loading options…
            </div>
          ) : unavailable ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {preference.error ? errorMessage(preference.error) : errorMessage(workspacesQuery.error)}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void preference.refetch()
                  void workspacesQuery.refetch()
                }}
              >
                Try again
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="starter-page-choice">Open this group on</Label>
                <Select value={choice} onValueChange={selectChoice}>
                  <SelectTrigger id="starter-page-choice" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Group default</SelectItem>
                    <SelectItem value="chat">Chat</SelectItem>
                    <SelectItem value="my-issues" disabled={!issuesAvailable}>
                      My issues
                    </SelectItem>
                    <SelectItem value="project" disabled={projects.length === 0}>
                      A project
                    </SelectItem>
                    <SelectItem value="course" disabled={courses.length === 0}>
                      A course
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(choice === 'project' || choice === 'course') && (
                <div className="space-y-1.5">
                  <Label htmlFor="starter-page-workspace">Choose {choice === 'project' ? 'a project' : 'a course'}</Label>
                  <Select value={workspaceId} onValueChange={(id) => setDraft({ type: choice, workspaceId: id })}>
                    <SelectTrigger id="starter-page-workspace" className="w-full">
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((workspace) => (
                        <SelectItem key={workspace.id} value={workspace.id}>
                          {workspace.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!canSave}>
              {save.isPending && <LoaderCircle className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
