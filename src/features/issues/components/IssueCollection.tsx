import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useCurrentTeam } from '@/features/teams/hooks'
import { issuePath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'
import { ownWrite } from '@/lib/realtime'
import { deleteIssue, issueKeys, type Issue, type IssueStatus } from '../api'
import { useIssueContext, useUpdateIssue } from '../hooks'
import { issueIdentifier } from '../meta'
import { IssueNavContext, type MenuKind } from '../nav-context'
import { moveIssueFocus, useShortcuts } from '../shortcuts'
import { CreateIssueDialog } from './CreateIssueDialog'
import { IssueBoard } from './IssueBoard'
import { IssueList } from './IssueList'
import { IssueRow } from './IssueRow'
import { ShortcutsDialog } from './ShortcutsDialog'

type IssueCollectionProps = {
  issues: Issue[]
  view: 'list' | 'board'
  /** List only: sub-issues under their parent. */
  nested?: boolean
  /** Shown instead of the list when there are no issues to show. */
  empty: ReactNode
  /** New issues start in this cycle (a cycle's page). */
  cycleId?: string | null
  /** New issues start in this plan (opened from a plan with ?new=1&plan=). */
  planId?: string | null
  /** Page-specific shortcuts (e.g. F for the filter menu). */
  shortcuts?: Record<string, () => void>
  /** The create dialog: open in a status, or closed (null). The page's "New issue" button opens it too. */
  creating: IssueStatus | null
  onCreatingChange: (status: IssueStatus | null) => void
}

/**
 * A set of issues as a List or Board, with Linear's keyboard model: C creates,
 * J/K (↓/↑) or hover focus a row, Enter opens it, S/P/A/L/⇧C open its status,
 * priority, assignee, labels or cycle menu, I assigns it to you, ? shows help.
 */
export function IssueCollection({
  issues,
  view,
  nested,
  empty,
  cycleId,
  planId,
  shortcuts,
  creating,
  onCreatingChange: setCreating,
}: IssueCollectionProps) {
  const { team } = useCurrentTeam()
  const { workspace, userId, canManage } = useIssueContext()
  const update = useUpdateIssue()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ issueId: string; kind: MenuKind } | null>(null)
  const [help, setHelp] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Issue | null>(null)
  const [deleting, setDeleting] = useState(false)

  const active = issues.find((i) => i.id === activeId)
  const open = (kind: MenuKind) => () => active && setMenu({ issueId: active.id, kind })
  const remove = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      ownWrite('issues', deleteTarget.id, 15_000)
      await deleteIssue(deleteTarget.id)
      toast.success(`${issueIdentifier(workspace.issue_key, deleteTarget.number)} was deleted`)
      setDeleteTarget(null)
      queryClient.removeQueries({ queryKey: issueKeys.detail(workspace.id, deleteTarget.number) })
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKeys.workspace(workspace.id) }),
        queryClient.invalidateQueries({ queryKey: ['issues', 'team'] }),
      ]).catch((error) => toast.error(errorMessage(error)))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  useShortcuts({
    c: () => setCreating('todo'),
    j: () => setActiveId(moveIssueFocus(activeId, 1)),
    arrowdown: () => setActiveId(moveIssueFocus(activeId, 1)),
    k: () => setActiveId(moveIssueFocus(activeId, -1)),
    arrowup: () => setActiveId(moveIssueFocus(activeId, -1)),
    enter: () => active && void navigate(issuePath(team.slug, workspace.id, active.number)),
    o: () => active && void navigate(issuePath(team.slug, workspace.id, active.number)),
    s: open('status'),
    p: open('priority'),
    a: open('assignee'),
    l: open('label'),
    'shift+c': open('cycle'),
    i: () =>
      active &&
      update.mutate({ issue: active, patch: { assignee_id: active.assignee_id === userId ? null : userId } }),
    escape: () => setActiveId(null),
    '?': () => setHelp(true),
    ...shortcuts,
  })

  return (
    <IssueNavContext.Provider value={{ activeId, setActiveId, menu, setMenu }}>
      {issues.length === 0 ? (
        empty
      ) : view === 'board' ? (
        <IssueBoard issues={issues} onCreate={setCreating} />
      ) : (
        <IssueList
          issues={issues}
          onCreate={setCreating}
          nested={nested}
          row={(issue, subIssues, nest) => (
            <IssueRow
              issue={issue}
              subIssues={subIssues}
              nest={nest}
              onDelete={canManage ? () => setDeleteTarget(issue) : undefined}
            />
          )}
        />
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${issueIdentifier(workspace.issue_key, deleteTarget.number)}?` : 'Delete issue?'}
        description="This can’t be undone. Its comments are deleted too; its sub-issues are kept and become top-level issues."
        confirmLabel="Delete issue"
        pending={deleting}
        onConfirm={() => void remove()}
      />
      {/* Keyed so its fields reset to where it was opened from. */}
      <CreateIssueDialog
        key={creating ?? 'closed'}
        open={creating !== null}
        status={creating ?? 'todo'}
        cycleId={cycleId}
        planId={planId}
        onOpenChange={(next) => !next && setCreating(null)}
      />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </IssueNavContext.Provider>
  )
}
