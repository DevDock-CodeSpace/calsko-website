import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, LoaderCircle, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { repoBranchesQuery, repoFullName, repoKeys, updateRepoBranches, type LinkedRepo } from '../api'

const DEFAULT = '__default__'
const MAX_DONE = 10

/**
 * One project's branch settings for a linked repo: where new issue branches
 * start, and which merges mark issues Done. Branch names come from GitHub
 * when the repo is connected; any name can also be typed.
 */
export function RepoBranchSettingsDialog({
  workspaceId,
  repo,
  onOpenChange,
}: {
  workspaceId: string
  repo: LinkedRepo
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const connected = repo.installation_id !== null
  const github = useQuery({ ...repoBranchesQuery(repo.id), enabled: connected })
  const defaultName = github.data?.defaultBranch ?? 'the default branch'
  const [base, setBase] = useState<string | null>(repo.base_branch)
  const [done, setDone] = useState<string[]>(repo.done_branches)
  const [custom, setCustom] = useState('')

  // GitHub's branches, plus any saved or typed ones GitHub doesn't list (yet).
  const names = [...new Set([...(github.data?.branches ?? []), ...done, ...(base ? [base] : [])])].sort((a, b) =>
    a.localeCompare(b),
  )
  const toggle = (name: string) =>
    setDone((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev.length < MAX_DONE ? [...prev, name] : prev))
  const addCustom = (event: FormEvent) => {
    event.preventDefault()
    const name = custom.trim()
    if (!name) return
    if (!done.includes(name)) toggle(name)
    setCustom('')
  }

  const save = useMutation({
    mutationFn: () => updateRepoBranches(workspaceId, repo.id, { baseBranch: base, doneBranches: done }),
    onSuccess: async () => {
      toast.success('Branch settings saved')
      await queryClient.invalidateQueries({ queryKey: repoKeys.all })
      onOpenChange(false)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Branch settings</DialogTitle>
          <DialogDescription>
            For <span className="font-mono">{repoFullName(repo)}</span> in this project.
          </DialogDescription>
        </DialogHeader>

        {github.isPending && connected && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Loading branches from GitHub…
          </p>
        )}
        {github.isError && (
          <p role="alert" className="text-sm text-destructive">
            {github.error.message}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="base-branch">New issue branches start from</Label>
          <Select value={base ?? DEFAULT} onValueChange={(v) => setBase(v === DEFAULT ? null : v)}>
            <SelectTrigger id="base-branch" className="w-full font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT} className="font-mono text-xs">
                None
              </SelectItem>
              {names.map((name) => (
                <SelectItem key={name} value={name} className="font-mono text-xs">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {base === null && (
            <p className="text-xs text-muted-foreground">Choose a branch to enable automatic issue-branch creation.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Merging into these marks issues Done</Label>
          <p className="text-xs text-muted-foreground">
            Tick the branch your feature PRs merge into (usually <span className="font-mono">dev</span> or{' '}
            <span className="font-mono">main</span>), not only the one you deploy from. Release PRs rarely mention issue IDs.
          </p>
          {names.length > 0 && (
            <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
              {names.map((name) => {
                const on = done.includes(name)
                return (
                  <li key={name}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(name)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                          on && 'border-brand bg-brand text-brand-foreground',
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="truncate font-mono text-xs">{name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <form onSubmit={addCustom} className="flex gap-2">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={connected ? 'Another branch name…' : 'Branch name, e.g. main'}
              aria-label="Add a done branch"
              className="h-8 font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!custom.trim() || done.length >= MAX_DONE}>
              <Plus /> Add
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            {done.length === 0 ? (
              <>None chosen: merging into {defaultName} marks issues Done.</>
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                Done on:
                {done.map((name) => (
                  <span key={name} className="inline-flex items-center gap-0.5 rounded-sm border px-1 font-mono">
                    {name}
                    <button type="button" aria-label={`Remove ${name}`} onClick={() => toggle(name)}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </span>
            )}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <LoaderCircle className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
