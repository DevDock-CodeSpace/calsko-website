import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleUserRound, Goal, ImagePlus, IterationCw, LoaderCircle, Tag, X } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { IMAGE_TYPES, imageProblem } from '@/features/docs/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { issuePath } from '@/features/teams/nav'
import type { Json } from '@/types/database.types'
import { createIssue, issueKeys, type Issue, type IssuePriority, type IssueStatus } from '../api'
import { cycleTitle } from '../cycles'
import { useIssueContext } from '../hooks'
import { imageNode, removeIssueImages, uploadIssueImage } from '../images'
import { issueIdentifier, priorityLabel, statusLabel } from '../meta'
import { AssigneePicker } from './AssigneePicker'
import { CyclePicker } from './CyclePicker'
import { PlanPicker } from '@/features/plans/components/PlanPicker'
import { PlanStatusDot } from '@/features/plans/components/PlanStatusDot'
import { LabelChip } from './LabelChip'
import { LabelPicker } from './LabelPicker'
import { RepoPicker } from './RepoPicker'
import { PriorityIcon } from './PriorityIcon'
import { PriorityPicker } from './PriorityPicker'
import { StatusIcon } from './StatusIcon'
import { StatusPicker } from './StatusPicker'
import { ownWrite } from '@/lib/realtime'
import { GitHubMark } from '@/features/repos/components/GitHubMark'
import type { Workspace } from '@/features/workspaces/api'

/**
 * Plain text (one paragraph per line) followed by the attached images → a
 * TipTap doc, the format descriptions are stored in.
 */
function toDoc(text: string, images: Json[]): Json | null {
  const paragraphs: Json[] = text.trim()
    ? text.split('\n').map((line) =>
        line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
      )
    : []
  if (paragraphs.length === 0 && images.length === 0) return null
  return { type: 'doc', content: [...paragraphs, ...images] }
}

/** An image chosen in the dialog; uploaded when the issue is created. */
type Attachment = { id: string; file: File; preview: string }

const MAX_ATTACHMENTS = 10
type IssueDialogContext = Omit<ReturnType<typeof useIssueContext>, 'workspace'> & {
  workspace: Pick<Workspace, 'id' | 'title' | 'issue_key'>
}

export type CreateIssueDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Starting status (e.g. the list group or board column it was opened from). */
  status?: IssueStatus
  /** Creates a sub-issue of this issue (starting in the same repo). */
  parent?: Pick<Issue, 'id' | 'number' | 'title' | 'repo_id' | 'plan_id'>
  /** Starting cycle (e.g. opened from a cycle's page). */
  cycleId?: string | null
  /** Starting plan (e.g. "New issue" on a plan's page). */
  planId?: string | null
}

/** Linear's "New issue" modal: title, description, and property chips. ⌘/Ctrl+Enter creates. */
export function CreateIssueDialog(props: CreateIssueDialogProps) {
  const context = useIssueContext()
  return <CreateIssueDialogForm {...props} context={context} />
}

export function CreateIssueDialogForm({
  open,
  onOpenChange,
  status: initialStatus = 'todo',
  parent,
  cycleId: initialCycle = null,
  planId: initialPlan = null,
  context,
}: CreateIssueDialogProps & { context: IssueDialogContext }) {
  const { team } = useCurrentTeam()
  const { workspace, members, labels, cycles, repos, plans, canManage, userId } = context
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<IssueStatus>(initialStatus)
  const [priority, setPriority] = useState<IssuePriority>(0)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [cycleId, setCycleId] = useState<string | null>(initialCycle)
  const [repoId, setRepoId] = useState<string | null>(parent?.repo_id ?? null)
  // A sub-issue is in its parent's plan (the database sets it either way).
  const [planId, setPlanId] = useState<string | null>(parent ? parent.plan_id : initialPlan)

  // Screenshots: pasted, dropped or picked. They're only uploaded on Create,
  // so cancelling leaves nothing behind.
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const addImages = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return false
    const problem = images.map(imageProblem).find((p) => p !== null)
    if (problem) toast.error(problem)
    const room = MAX_ATTACHMENTS - attachments.length
    const accepted = images.filter((file) => imageProblem(file) === null).slice(0, Math.max(0, room))
    if (accepted.length < images.filter((file) => imageProblem(file) === null).length) {
      toast.error(`An issue can start with at most ${MAX_ATTACHMENTS} images. Add more on the issue page.`)
    }
    setAttachments((current) => [
      ...current,
      ...accepted.map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) })),
    ])
    return true
  }
  const removeAttachment = (id: string) =>
    setAttachments((current) => {
      current.filter((a) => a.id === id).forEach((a) => URL.revokeObjectURL(a.preview))
      return current.filter((a) => a.id !== id)
    })
  // Release the previews when the dialog goes away.
  const latestAttachments = useRef(attachments)
  useEffect(() => {
    latestAttachments.current = attachments
  })
  useEffect(
    () => () => {
      latestAttachments.current.forEach((a) => URL.revokeObjectURL(a.preview))
    },
    [],
  )

  const reset = () => {
    attachments.forEach((a) => URL.revokeObjectURL(a.preview))
    setAttachments([])
    setTitle('')
    setDescription('')
    setStatus(initialStatus)
    setPriority(0)
    setAssigneeId(null)
    setLabelIds([])
    setCycleId(initialCycle)
    setRepoId(parent?.repo_id ?? null)
    setPlanId(parent ? parent.plan_id : initialPlan)
  }

  const create = useMutation({
    mutationFn: async () => {
      const paths: string[] = []
      try {
        for (const { file } of attachments) paths.push(await uploadIssueImage(workspace.id, file))
        const made = await createIssue({
          workspaceId: workspace.id,
          title,
          description: toDoc(
            description,
            paths.map((path, i) => imageNode(path, attachments[i].file.name)),
          ),
          status,
          priority,
          assigneeId,
          parentId: parent?.id ?? null,
          cycleId,
          repoId,
          planId,
          labelIds,
        })
        // Refetched below, so its own live-update echo (the issue, its labels, its first activity) isn't needed.
        for (const table of ['issues', 'issue_label_links', 'issue_activity']) ownWrite(table, made.id)
        return made
      } catch (error) {
        // Nothing points at the uploaded images: take them back.
        await removeIssueImages(paths)
        throw error
      }
    },
    onSuccess: async ({ number }) => {
      // The lists it shows up in, and an open parent (a new sub-issue).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKeys.workspace(workspace.id) }),
        queryClient.invalidateQueries({ queryKey: ['issues', 'team'] }),
        ...(parent ? [queryClient.invalidateQueries({ queryKey: issueKeys.detail(workspace.id, parent.number) })] : []),
      ])
      const id = issueIdentifier(workspace.issue_key, number)
      toast.success(`${id} created`, {
        description: title.trim(),
        action: { label: 'View', onClick: () => void navigate(issuePath(team.slug, workspace.id, number)) },
      })
      reset()
      onOpenChange(false)
    },
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (title.trim() && !create.isPending) create.mutate()
  }

  const assignee = members.find((m) => m.user_id === assigneeId)
  const chosenLabels = labels.filter((l) => labelIds.includes(l.id))
  const cycle = cycles.find((c) => c.id === cycleId)
  const plan = plans.find((p) => p.id === planId)
  const repo = repos.find((r) => r.id === repoId)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) create.reset()
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-2xl" showCloseButton={false}>
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
          onPaste={(e) => {
            // A pasted screenshot becomes an attachment. Text pastes as usual, including from
            // apps that also put a picture of the text on the clipboard (spreadsheets, Word).
            if (e.clipboardData.getData('text/plain')) return
            if (addImages(Array.from(e.clipboardData.files))) e.preventDefault()
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDrop={(e) => {
            if (addImages(Array.from(e.dataTransfer.files))) e.preventDefault()
          }}
        >
          <div className="flex items-center gap-1.5 px-5 pt-4 text-xs text-muted-foreground">
            <span className="rounded border px-1.5 py-0.5 font-mono">{workspace.issue_key}</span>
            <ChevronRight className="size-3" />
            <DialogTitle className="text-xs font-normal text-foreground">
              {parent ? `New sub-issue of ${issueIdentifier(workspace.issue_key, parent.number)}` : 'New issue'}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">Create an issue in {workspace.title}.</DialogDescription>
          <div className="px-5 pt-3">
            <input
              autoFocus
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              aria-label="Issue title"
              className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description… (paste or drop a screenshot)"
              aria-label="Description"
              rows={4}
              className="mt-2 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            {attachments.length > 0 && (
              <ul aria-label="Attached images" className="mb-3 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <li key={a.id} className="group relative">
                    <img
                      src={a.preview}
                      alt={a.file.name}
                      title={a.file.name}
                      className="h-16 w-24 rounded-md border object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${a.file.name}`}
                      onClick={() => removeAttachment(a.id)}
                      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => {
                addImages(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">
            <StatusPicker value={status} onChange={setStatus}>
              <Chip>
                <StatusIcon status={status} />
                {statusLabel[status]}
              </Chip>
            </StatusPicker>
            <PriorityPicker value={priority} onChange={setPriority}>
              <Chip>
                <PriorityIcon priority={priority} />
                {priority === 0 ? 'Priority' : priorityLabel[priority]}
              </Chip>
            </PriorityPicker>
            <AssigneePicker value={assigneeId} members={members} userId={userId} onChange={setAssigneeId}>
              <Chip>
                {assignee ? (
                  <PersonAvatar profile={assignee.profile} className="size-4" />
                ) : (
                  <CircleUserRound className="size-3.5 text-muted-foreground" />
                )}
                {assignee ? (assignee.profile?.display_name ?? 'Unnamed member') : 'Assignee'}
              </Chip>
            </AssigneePicker>
            <LabelPicker
              workspaceId={workspace.id}
              value={labelIds}
              labels={labels}
              canCreate={canManage}
              onChange={setLabelIds}
            >
              <Chip>
                {chosenLabels.length === 0 ? (
                  <>
                    <Tag className="size-3.5 text-muted-foreground" /> Labels
                  </>
                ) : (
                  chosenLabels.map((l) => <LabelChip key={l.id} label={l} className="h-4 border-0 px-0" />)
                )}
              </Chip>
            </LabelPicker>
            {cycles.length > 0 && (
              <CyclePicker value={cycleId} cycles={cycles} onChange={setCycleId}>
                <Chip>
                  <IterationCw className="size-3.5 text-muted-foreground" />
                  {cycle ? cycleTitle(cycle) : 'Sprint'}
                </Chip>
              </CyclePicker>
            )}
            {parent
              ? plan && (
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground" title="A sub-issue is in its parent’s plan">
                    <PlanStatusDot status={plan.status} /> {plan.name}
                  </span>
                )
              : plans.length > 0 && (
                  <PlanPicker value={planId} plans={plans} onChange={setPlanId}>
                    <Chip>
                      {plan ? <PlanStatusDot status={plan.status} /> : <Goal className="size-3.5 text-muted-foreground" />}
                      {plan ? plan.name : 'Plan'}
                    </Chip>
                  </PlanPicker>
                )}
            {repos.length > 0 && (
              <RepoPicker value={repoId} repos={repos} onChange={setRepoId}>
                <Chip>
                  <GitHubMark className="size-3.5 text-muted-foreground" />
                  {repo ? repo.name : 'Repository'}
                </Chip>
              </RepoPicker>
            )}
            <Chip onClick={() => fileInput.current?.click()} title="Attach a screenshot (or paste / drop it)">
              <ImagePlus className="size-3.5 text-muted-foreground" />
              Image
            </Chip>
          </div>
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
            <p role="alert" className="min-w-0 truncate text-sm text-destructive">
              {create.isError ? create.error.message : null}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!title.trim() || create.isPending}>
                {create.isPending && <LoaderCircle className="animate-spin" />}
                Create issue
                <kbd className="ml-1 font-mono text-[10px] opacity-70">⌘↵</kbd>
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A property button in the create modal's chip row. */
function Chip({ children, ...props }: { children: ReactNode } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
