import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeft, Bookmark, ChevronRight, GitBranch, Trash2 } from 'lucide-react'
import { StarButton } from './StarButton'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ReminderDialog } from '@/features/reminders/components/ReminderDialog'
import { useCurrentTeam } from '@/features/teams/hooks'
import { issuePath, issuesPath } from '@/features/teams/nav'
import { AUTOSAVE_MS, useSaveOnExit } from '@/hooks/use-save-on-exit'
import { errorMessage } from '@/lib/errors'
import { deleteIssue, issueBranchesQuery, issueKeys, workspaceIssuesQuery, type IssueDetail } from '../api'
import { copyBranchName } from '../copyBranch'
import { useIssueContext, useUpdateIssue } from '../hooks'
import { issueIdentifier } from '../meta'
import type { MenuKind } from '../nav-context'
import { useShortcuts } from '../shortcuts'
import { IssueActivity } from './IssueActivity'
import { IssueDescription } from './IssueDescription'
import { IssueDevelopment } from './IssueDevelopment'
import { IssueErrorBlock } from '@/features/errors/components/IssueErrorBlock'
import { IssueProperties } from './IssueProperties'
import { ShortcutsDialog } from './ShortcutsDialog'
import { SubIssues } from './SubIssues'
import { ownWrite } from '@/lib/realtime'

/**
 * The issue page (lazy-loaded with the description editor), laid out like
 * Linear's: title, description, sub-issues and comments; properties on the right.
 */
export default function IssueView({ issue }: { issue: IssueDetail }) {
  const { team } = useCurrentTeam()
  const { workspace, canManage, userId } = useIssueContext()
  const issues = useSuspenseQuery(workspaceIssuesQuery(workspace.id)).data
  const update = useUpdateIssue()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const parent = issues.find((i) => i.id === issue.parent_id)
  const id = issueIdentifier(workspace.issue_key, issue.number)
  // Only an actual GitHub branch has a name to show.
  const branches = useQuery(issueBranchesQuery(issue.id)).data
  const branchName = branches?.[0]?.name ?? null

  // ------------------------------------------------------------ shortcuts
  // S/P/A/L/⇧C open the property menus, I assigns to me, Esc goes back, ? shows help.
  const [menu, setMenu] = useState<MenuKind | null>(null)
  const [help, setHelp] = useState(false)
  const [reminding, setReminding] = useState(false)
  useShortcuts({
    s: () => setMenu('status'),
    p: () => setMenu('priority'),
    a: () => setMenu('assignee'),
    l: () => setMenu('label'),
    'shift+c': () => setMenu('cycle'),
    i: () => update.mutate({ issue, patch: { assignee_id: issue.assignee_id === userId ? null : userId } }),
    escape: () => void navigate(issuesPath(team.slug, workspace.id)),
    '?': () => setHelp(true),
  })

  // ------------------------------------------------------------ title
  // Saved while typing, on blur, and when leaving the issue (like Linear).
  const [title, setTitle] = useState(issue.title)
  const [editingTitle, setEditingTitle] = useState(false)
  // A title that changed elsewhere (or a save that was rolled back) shows up here, unless it's being edited.
  const [shownTitle, setShownTitle] = useState(issue.title)
  if (shownTitle !== issue.title) {
    setShownTitle(issue.title)
    if (!editingTitle) setTitle(issue.title)
  }
  const titleField = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = titleField.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])
  const draft = useRef<string | undefined>(undefined) // typed, not saved yet
  const titleTimer = useRef<number | undefined>(undefined)
  const titleAtFocus = useRef(issue.title)
  const commitTitle = () => {
    window.clearTimeout(titleTimer.current)
    const next = draft.current?.trim()
    draft.current = undefined
    // An empty title is never saved; the field goes back to the saved one on blur.
    if (!next || next === issue.title) return undefined
    update.mutate({ issue, patch: { title: next } })
    return next
  }
  const latestCommit = useRef(commitTitle)
  useEffect(() => {
    latestCommit.current = commitTitle
  })
  useEffect(
    () => () => {
      latestCommit.current()
    },
    [],
  )
  useSaveOnExit(
    () => !!draft.current?.trim() && draft.current.trim() !== issue.title,
    () => latestCommit.current(),
  )

  // ------------------------------------------------------------ delete
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const remove = async () => {
    setDeleting(true)
    try {
      ownWrite('issues', issue.id, 15_000)
      await deleteIssue(issue.id)
      toast.success(`${id} was deleted`)
      // Leave the page before dropping its data (see useExitTeam for why).
      await navigate(issuesPath(team.slug, workspace.id), { replace: true })
      queryClient.removeQueries({ queryKey: issueKeys.detail(workspace.id, issue.number) })
      // Only the lists showed it (its sub-issues come back in the same list).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKeys.workspace(workspace.id) }),
        queryClient.invalidateQueries({ queryKey: ['issues', 'team'] }),
      ])
    } catch (error) {
      toast.error(errorMessage(error))
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
      <div className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between gap-3">
          <nav aria-label="Issue" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Link to={issuesPath(team.slug, workspace.id)} className="inline-flex shrink-0 items-center gap-1 hover:text-foreground">
              <ArrowLeft className="size-3.5" /> Issues
            </Link>
            {parent && (
              <>
                <ChevronRight className="size-3 shrink-0" />
                <Link
                  to={issuePath(team.slug, workspace.id, parent.number)}
                  className="min-w-0 truncate hover:text-foreground"
                  title={parent.title}
                >
                  <span className="font-mono">{issueIdentifier(workspace.issue_key, parent.number)}</span> {parent.title}
                </Link>
              </>
            )}
            <ChevronRight className="size-3 shrink-0" />
            <span className="shrink-0 font-mono text-foreground">{id}</span>
          </nav>
          <div className="flex shrink-0 items-center gap-0.5">
            {branchName && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy branch name"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void copyBranchName(branchName)}
                  >
                    <GitBranch />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy branch name</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add a note"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setReminding(true)}
                >
                  <Bookmark />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add a note about this issue</TooltipContent>
            </Tooltip>
            <StarButton target={{ kind: 'issue', issueId: issue.id }} label="this issue" />
            {canManage && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete issue"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </div>

        <textarea
          ref={titleField}
          value={title}
          rows={1}
          maxLength={300}
          aria-label="Title"
          placeholder="Issue title"
          onChange={(e) => {
            const next = e.target.value.replace(/\n/g, ' ')
            setTitle(next)
            draft.current = next
            window.clearTimeout(titleTimer.current)
            titleTimer.current = window.setTimeout(() => latestCommit.current(), AUTOSAVE_MS)
          }}
          onFocus={() => {
            setEditingTitle(true)
            titleAtFocus.current = issue.title
          }}
          onBlur={() => {
            // Show what is saved (or being saved); a failed save rolls it back.
            const saving = commitTitle()
            setEditingTitle(false)
            setTitle(saving ?? issue.title)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              // Undo this edit, including what was already saved while typing.
              draft.current = titleAtFocus.current
              setTitle(titleAtFocus.current)
              e.currentTarget.blur()
            }
          }}
          className="mb-3 block w-full resize-none overflow-hidden bg-transparent text-2xl leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
        />

        <IssueDescription issue={issue} />

        <div className="mt-10 space-y-10 border-t pt-6">
          <SubIssues issue={issue} />
          <IssueActivity issue={issue} />
        </div>
      </div>

      <div className="shrink-0 border-t pt-6 lg:w-64 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
        <IssueProperties issue={issue} menu={menu} onMenuChange={setMenu} />
        <IssueDevelopment issue={issue} />
        {issue.error && <IssueErrorBlock error={issue.error} />}
      </div>

      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      {/* Mounted only while open: the issue page loads nothing for notes. */}
      {reminding && (
        <ReminderDialog
          open
          onOpenChange={setReminding}
          defaults={{ remind: true, workspaceId: workspace.id, issueId: issue.id, issueLabel: `${id} ${issue.title}` }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${id}?`}
        description="This can’t be undone. Its comments are deleted too; its sub-issues are kept and become top-level issues."
        confirmLabel="Delete issue"
        pending={deleting}
        onConfirm={() => void remove()}
      />
    </div>
  )
}
