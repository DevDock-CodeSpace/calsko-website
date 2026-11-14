import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, LoaderCircle, Plus, X } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { repoBranchesQuery, repoFullName, repoKeys, updateRepoBranches, type LinkedRepo } from '../api'

const DEFAULT = '__default__'
const MAX_DONE = 10
const BRANCH_NAME_RE = /^[^\s~^:?*[\]\\]{1,255}$/

const isValidBranchName = (name: string) => BRANCH_NAME_RE.test(name)

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
  const [baseCustom, setBaseCustom] = useState(repo.base_branch ?? '')
  const [done, setDone] = useState<string[]>(repo.done_branches)
  const [custom, setCustom] = useState('')
  const [baseOptionsOpen, setBaseOptionsOpen] = useState(false)
  const [doneOptionsOpen, setDoneOptionsOpen] = useState(false)
  const [baseSearch, setBaseSearch] = useState('')
  const baseInputWrapper = useRef<HTMLDivElement>(null)
  const doneInputWrapper = useRef<HTMLDivElement>(null)

  const validateBranchName = (name: string) => {
    if (!isValidBranchName(name)) {
      toast.error('Branch names can’t contain spaces or ~^:?*[\\ and must be 1–255 characters long.')
      return false
    }
    return true
  }

  // GitHub's branches, plus any saved or typed ones GitHub doesn't list (yet).
  const names = useMemo(
    () => [...new Set([...(github.data?.branches ?? []), ...done, ...(base ? [base] : [])])].sort((a, b) => a.localeCompare(b)),
    [base, done, github.data?.branches],
  )
  const baseOptions = useMemo(() => {
    const query = baseSearch.trim().toLowerCase()
    return [DEFAULT, ...names].filter((name) => {
      const label = name === DEFAULT ? 'None' : name
      return !query || label.toLowerCase().includes(query)
    })
  }, [baseSearch, names])
  const doneOptions = useMemo(() => {
    const query = custom.trim().toLowerCase()
    return names.filter((name) => !query || name.toLowerCase().includes(query))
  }, [custom, names])
  const setBaseOptions = (open: boolean) => {
    setBaseOptionsOpen(open)
    if (open) setDoneOptionsOpen(false)
    else setBaseSearch('')
  }
  const chooseBase = (name: string) => {
    const next = name === DEFAULT ? null : name
    setBase(next)
    setBaseCustom(next ?? '')
    setBaseOptions(false)
  }
  const setCustomBase = (value: string) => {
    const next = value.trimStart()
    setBaseCustom(next)
    setBase(next.trim() || null)
    setBaseSearch(next)
  }
  const openBaseOptions = () => {
    if (baseOptionsOpen) return
    setDoneOptionsOpen(false)
    setBaseSearch('')
    setBaseOptionsOpen(true)
  }
  const openDoneOptions = () => {
    setBaseOptionsOpen(false)
    setDoneOptionsOpen(true)
  }
  const toggle = (name: string) =>
    setDone((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev.length < MAX_DONE ? [...prev, name] : prev))
  const addCustom = (event: FormEvent) => {
    event.preventDefault()
    const name = custom.trim()
    if (!name) return
    if (!validateBranchName(name)) return
    if (!done.includes(name)) toggle(name)
    setCustom('')
    setDoneOptionsOpen(false)
  }

  const validateSettings = () => {
    if (base && !validateBranchName(base)) return false
    const invalid = done.find((name) => !isValidBranchName(name))
    if (invalid) {
      toast.error(`The done branch “${invalid}” can’t contain spaces or ~^:?*[\\ and must be 1–255 characters long.`)
      return false
    }
    return true
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
      <DialogContent className="max-h-[min(85dvh,48rem)] overflow-x-hidden overflow-y-auto sm:max-w-md">
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

        <div className="space-y-2">
          <Label id="base-branch-label">New issue branches start from</Label>
          <Popover open={baseOptionsOpen} onOpenChange={setBaseOptions}>
            <PopoverAnchor asChild>
              <div ref={baseInputWrapper} className="min-w-0">
                <Input
                  value={baseCustom}
                  onChange={(event) => setCustomBase(event.target.value)}
                  onClick={openBaseOptions}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      openBaseOptions()
                    }
                  }}
                  placeholder={connected ? 'Choose or type a base branch…' : 'Branch name, e.g. main'}
                  aria-label="Base branch"
                  aria-expanded={baseOptionsOpen}
                  aria-controls="base-branch-options"
                  className="h-9 min-w-0 font-mono text-xs"
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              side="bottom"
              className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (event.target instanceof Node && baseInputWrapper.current?.contains(event.target)) {
                  event.preventDefault()
                }
              }}
            >
              <ul
                id="base-branch-options"
                aria-labelledby="base-branch-label"
                className="max-h-32 overflow-x-hidden overflow-y-auto p-1"
              >
                {baseOptions.length === 0 ? (
                  <li className="px-2 py-2 text-xs text-muted-foreground">No matching branches.</li>
                ) : (
                  baseOptions.map((name) => {
                    const isNone = name === DEFAULT
                    const selected = isNone ? base === null : base === name
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          title={isNone ? 'No base branch selected' : name}
                          onClick={() => chooseBase(name)}
                          className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        >
                          <span
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                              selected && 'border-brand bg-brand text-brand-foreground',
                            )}
                          >
                            {selected && <Check className="size-3" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{isNone ? 'None' : name}</span>
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </PopoverContent>
          </Popover>
          {base === null && (
            <p className="text-xs text-muted-foreground">Choose a branch to enable automatic issue-branch creation.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Merging into these marks issues Done</Label>
          <p className="text-xs text-muted-foreground">
            Tick the branch your feature PRs merge into (usually <span className="font-mono">dev</span> or{' '}
            <span className="font-mono">main</span>), not only the one you deploy from. Release PRs rarely mention issue IDs.
          </p>
          <form onSubmit={addCustom} className="flex min-w-0 gap-2">
            <Popover
              open={doneOptionsOpen}
              onOpenChange={(open) => {
                setDoneOptionsOpen(open)
                if (open) setBaseOptionsOpen(false)
              }}
            >
              <PopoverAnchor asChild>
                <div ref={doneInputWrapper} className="min-w-0 flex-1">
                  <Input
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    onClick={openDoneOptions}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        openDoneOptions()
                      }
                    }}
                    placeholder={connected ? 'Search or add a branch…' : 'Branch name, e.g. main'}
                    aria-label="Search or add a Done branch"
                    aria-expanded={doneOptionsOpen}
                    aria-controls="done-branch-options"
                    className="h-9 min-w-0 font-mono text-xs"
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                align="start"
                side="bottom"
                className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={(event) => {
                  if (event.target instanceof Node && doneInputWrapper.current?.contains(event.target)) {
                    event.preventDefault()
                  }
                }}
              >
                <ul
                  id="done-branch-options"
                  aria-label="Branches that mark issues Done"
                  className="max-h-28 overflow-x-hidden overflow-y-auto p-1"
                >
                  {doneOptions.length === 0 ? (
                    <li className="px-2 py-2 text-xs text-muted-foreground">
                      {custom.trim() ? 'No matching branches. Use Add to save this branch.' : 'No branches available yet.'}
                    </li>
                  ) : (
                    doneOptions.map((name) => {
                      const selected = done.includes(name)
                      return (
                        <li key={name}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            disabled={!selected && done.length >= MAX_DONE}
                            title={name}
                            onClick={() => {
                              toggle(name)
                              setCustom('')
                            }}
                            className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span
                              className={cn(
                                'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                                selected && 'border-brand bg-brand text-brand-foreground',
                              )}
                            >
                              {selected && <Check className="size-3" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
              </PopoverContent>
            </Popover>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="h-9 shrink-0"
              disabled={!custom.trim() || done.length >= MAX_DONE}
            >
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
                  <span key={name} className="inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-sm border px-1 font-mono">
                    <span className="truncate">{name}</span>
                    <button type="button" aria-label={`Remove ${name}`} onClick={() => toggle(name)} className="shrink-0">
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
          <Button
            disabled={save.isPending}
            onClick={() => {
              if (!validateSettings()) return
              save.mutate()
            }}
          >
            {save.isPending && <LoaderCircle className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
