import { FolderGit2, LoaderCircle, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { repoFullName, type GitHubInstallation, type TeamRepo } from '../api'
import { useLinkRepo } from '../hooks'
import { GitHubRepoChooser } from './GitHubRepoChooser'
import { NotConnectedBadge } from './NotConnectedBadge'

/**
 * Link a repo to this workspace: pick one the group already has. Group
 * owners/admins can also add one: from GitHub once it's connected, otherwise
 * by typing owner/name or a URL. Leads can only link repos already in the group.
 */
export function LinkRepoDialog({
  teamId,
  workspaceId,
  teamRepos,
  linkedIds,
  canAdd,
  installations,
}: {
  teamId: string
  workspaceId: string
  teamRepos: TeamRepo[]
  linkedIds: string[]
  canAdd: boolean
  installations: GitHubInstallation[]
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const link = useLinkRepo(teamId, workspaceId, teamRepos, canAdd)
  const available = teamRepos.filter((r) => !linkedIds.includes(r.id))
  const connected = installations.length > 0

  const close = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setText('')
      link.reset()
    }
  }
  const run = (input: { repoId: string } | { githubRepoId: number } | { text: string }) => link.mutate(input, { onSuccess: () => close(false) })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() && !link.isPending) run({ text })
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Link repository
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Link a repository</DialogTitle>
            <DialogDescription>
              Issues in this project can then be assigned to it. A repository can be linked to several projects.
            </DialogDescription>
          </DialogHeader>

          {available.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">In this group</p>
              <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                {available.map((repo) => (
                  <li key={repo.id}>
                    <button
                      type="button"
                      disabled={link.isPending}
                      onClick={() => run({ repoId: repo.id })}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
                    >
                      <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-xs">{repoFullName(repo)}</span>
                      {connected && repo.installation_id === null && <NotConnectedBadge />}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">Link</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {connected && canAdd && open && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">From GitHub</p>
              <GitHubRepoChooser
                teamId={teamId}
                groupRepos={teamRepos}
                installations={installations}
                disabled={link.isPending}
                onPick={(repo) => run({ githubRepoId: repo.githubRepoId })}
              />
            </div>
          )}

          {connected && !canAdd && (
            <p className="text-sm text-muted-foreground">
              {available.length === 0 ? 'No repositories in this group are left to link. ' : ''}
              Only group owners and admins can add repositories from GitHub to the group, in Group settings → Repositories.
            </p>
          )}

          {!connected && (
            <div className="space-y-1.5">
              <Label htmlFor="repo-input">{canAdd ? 'Or add one by name' : 'Find by name'}</Label>
              <Input
                id="repo-input"
                value={text}
                autoFocus
                placeholder="owner/name or https://github.com/owner/name"
                className="font-mono text-xs"
                onChange={(e) => setText(e.target.value)}
              />
              {!canAdd && (
                <p className="text-xs text-muted-foreground">
                  Only group owners and admins can add new repositories to the group.
                </p>
              )}
            </div>
          )}

          {link.isError && (
            <p role="alert" className="text-sm text-destructive">
              {link.error.message}
            </p>
          )}
          {!connected && (
            <DialogFooter>
              <Button type="submit" disabled={!text.trim() || link.isPending}>
                {link.isPending && <LoaderCircle className="animate-spin" />}
                Link
              </Button>
            </DialogFooter>
          )}
          {connected && available.length === 0 && !canAdd && (
            <p className="text-sm text-muted-foreground">
              Every repository in this group is already linked. Ask a group owner or admin to add more.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
