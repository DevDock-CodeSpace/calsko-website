import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/hooks'
import { createGroupConversation, teamConversationsQuery, type Conversation } from '@/features/messaging/api'
import { teamMembersQuery } from '@/features/teams/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { teamWorkspacesQuery, workspaceMembersQuery } from '@/features/workspaces/api'
import { errorMessage } from '@/lib/errors'
import { NEW_ACTIVITY, NEW_PRIVATE, SAME_AS_FEED } from '../targets'

/**
 * Who sees a feed's messages: a channel (the whole group) or a private conversation (its people), or a new
 * private conversation made right here.
 */
export function TargetPicker({
  value,
  targets,
  onChange,
  disabled,
  label,
  allowNewActivity = false,
  allowSame = false,
  className = 'w-52',
}: {
  value: string | undefined
  targets: Conversation[]
  onChange: (value: string) => void
  disabled?: boolean
  label: string
  /** Offer "# activity (new)" when the group has none. */
  allowNewActivity?: boolean
  /** Offer "Same as above" (per-event targets). */
  allowSame?: boolean
  className?: string
}) {
  const [creating, setCreating] = useState(false)
  const channels = targets.filter((c) => c.kind === 'channel')
  const people = targets.filter((c) => c.kind === 'group')
  const showNewActivity = allowNewActivity && !channels.some((c) => c.name?.toLowerCase() === 'activity')
  return (
    <>
      <Select value={value} onValueChange={(next) => (next === NEW_PRIVATE ? setCreating(true) : onChange(next))} disabled={disabled}>
        <SelectTrigger size="sm" className={className} aria-label={label}>
          <SelectValue placeholder="Choose where" />
        </SelectTrigger>
        <SelectContent>
          {allowSame && (
            <>
              <SelectItem value={SAME_AS_FEED}>Same as above</SelectItem>
              <SelectSeparator />
            </>
          )}
          <SelectGroup>
            <SelectLabel>Whole group</SelectLabel>
            {showNewActivity && <SelectItem value={NEW_ACTIVITY}># activity (new)</SelectItem>}
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                # {c.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Chosen people</SelectLabel>
            {people.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name ?? 'Group conversation'}
              </SelectItem>
            ))}
            <SelectItem value={NEW_PRIVATE}>New private conversation…</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {creating && (
        <NewPrivateConversationDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            onChange(id)
          }}
        />
      )}
    </>
  )
}

/** A private conversation for a feed: a name and its people, optionally starting from a project's members. */
function NewPrivateConversationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useAuth()
  const { team } = useCurrentTeam()
  const queryClient = useQueryClient()
  const [{ data: members }, { data: workspaces }] = useSuspenseQueries({ queries: [teamMembersQuery(team.id), teamWorkspacesQuery(team.id)] })
  const others = members.filter((m) => m.user_id !== user.id)
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [loadingProject, setLoadingProject] = useState(false)

  // Copies the project's people in once; later changes to the project don't follow (pick by hand).
  const fromProject = async (workspaceId: string) => {
    const project = workspaces.find((w) => w.id === workspaceId)
    setLoadingProject(true)
    try {
      const people = await queryClient.fetchQuery(workspaceMembersQuery(workspaceId))
      const ids = people.map((p) => p.user_id).filter((id) => id !== user.id && others.some((m) => m.user_id === id))
      setChosen(ids)
      if (!name.trim() && project) setName(`${project.title} alerts`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setLoadingProject(false)
    }
  }

  const create = useMutation({
    mutationFn: () => createGroupConversation(team.id, name, [user.id, ...chosen]),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: teamConversationsQuery(team.id).queryKey })
      onCreated(id)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() && chosen.length > 0) create.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>New private conversation</DialogTitle>
            <DialogDescription>Only the people you choose (and you) see what's posted here, and only they are notified of critical alerts.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="feed-conversation-name">Name</Label>
              <Input id="feed-conversation-name" autoFocus maxLength={120} placeholder="On-call" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Start with a project’s members</Label>
              <Select onValueChange={(id) => void fromProject(id)} disabled={loadingProject}>
                <SelectTrigger size="sm" className="w-full" aria-label="Start with a project’s members">
                  <SelectValue placeholder={loadingProject ? 'Loading…' : 'Choose a project (optional)'} />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Copies who's in it now. People who join the project later aren't added by themselves.</p>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">People</legend>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {others.length === 0 && <p className="text-sm text-muted-foreground">No one else is in the group yet.</p>}
                {others.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={chosen.includes(m.user_id)}
                      onChange={(e) => setChosen((now) => (e.target.checked ? [...now, m.user_id] : now.filter((id) => id !== m.user_id)))}
                    />
                    {m.profile?.display_name ?? 'Unnamed member'}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || chosen.length === 0 || create.isPending}>
              {create.isPending && <LoaderCircle className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
