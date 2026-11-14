import { useSuspenseQuery } from '@tanstack/react-query'
import { CircleUserRound, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { PersonAvatar } from '@/components/PersonRow'
import { useCurrentTeam } from '@/features/teams/hooks'
import { issuePath } from '@/features/teams/nav'
import { cn } from '@/lib/utils'
import { workspaceIssuesQuery, type IssueDetail } from '../api'
import { useIssueContext, useUpdateIssue } from '../hooks'
import { compareIssues, isClosed, issueIdentifier, priorityLabel, statusLabel } from '../meta'
import { CreateIssueDialog } from './CreateIssueDialog'
import { LabelChip } from './LabelChip'
import { PriorityIcon } from './PriorityIcon'
import { PriorityPicker } from './PriorityPicker'
import { StatusIcon } from './StatusIcon'
import { StatusPicker } from './StatusPicker'

/** The issue's direct sub-issues with a progress bar, like Linear; "+" creates one. */
export function SubIssues({ issue }: { issue: IssueDetail }) {
  const { team } = useCurrentTeam()
  const { workspace, members, labels } = useIssueContext()
  const all = useSuspenseQuery(workspaceIssuesQuery(workspace.id)).data
  const update = useUpdateIssue()
  const [creating, setCreating] = useState(false)
  const children = all.filter((i) => i.parent_id === issue.id).sort(compareIssues)
  const done = children.filter((i) => isClosed(i.status)).length

  return (
    <section aria-label="Sub-issues">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-sm font-semibold">Sub-issues</h2>
        {children.length > 0 && (
          <>
            <div className="h-1 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full bg-brand" style={{ width: `${(done / children.length) * 100}%` }} />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {done}/{children.length}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" /> Add sub-issue
        </button>
      </div>
      {children.length > 0 && (
        <ul className="divide-y border-y">
          {children.map((child) => {
            const assignee = members.find((m) => m.user_id === child.assignee_id)
            const childLabels = labels.filter((label) => child.labelIds.includes(label.id))
            return (
              <li key={child.id} className="relative flex min-h-9 flex-wrap items-center gap-2 px-2 py-1 text-sm hover:bg-muted/50">
                <PriorityPicker value={child.priority} onChange={(priority) => update.mutate({ issue: child, patch: { priority } })}>
                  <button
                    type="button"
                    className="relative z-10 inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1 hover:bg-muted"
                    aria-label={`Priority: ${priorityLabel[child.priority]}`}
                    title={`Priority: ${priorityLabel[child.priority]}`}
                  >
                    <PriorityIcon priority={child.priority} />
                    <span className="text-xs text-muted-foreground">{priorityLabel[child.priority]}</span>
                  </button>
                </PriorityPicker>
                <StatusPicker value={child.status} onChange={(status) => update.mutate({ issue: child, patch: { status } })}>
                  <button
                    type="button"
                    className="relative z-10 inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1 hover:bg-muted"
                    aria-label={`Status: ${statusLabel[child.status]}`}
                    title={`Status: ${statusLabel[child.status]}`}
                  >
                    <StatusIcon status={child.status} />
                    <span className="text-xs text-muted-foreground">{statusLabel[child.status]}</span>
                  </button>
                </StatusPicker>
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                  {issueIdentifier(workspace.issue_key, child.number)}
                </span>
                <Link
                  to={issuePath(team.slug, workspace.id, child.number)}
                  className={cn(
                    'min-w-0 flex-1 truncate outline-none after:absolute after:inset-0',
                    isClosed(child.status) && 'text-muted-foreground line-through decoration-muted-foreground/50',
                  )}
                >
                  {child.title}
                </Link>
                {childLabels.length > 0 && (
                  <span
                    className="relative z-10 flex min-w-0 items-center gap-1"
                    title={childLabels.map((label) => label.name).join(', ')}
                  >
                    {childLabels.slice(0, 2).map((label) => (
                      <LabelChip key={label.id} label={label} className="max-w-28" />
                    ))}
                    {childLabels.length > 2 && (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        +{childLabels.length - 2}
                      </span>
                    )}
                  </span>
                )}
                {assignee ? (
                  <span className="relative z-10 shrink-0">
                    <PersonAvatar profile={assignee.profile} className="size-5" />
                  </span>
                ) : (
                  <CircleUserRound className="relative z-10 size-4 shrink-0 text-muted-foreground/60" />
                )}
              </li>
            )
          })}
        </ul>
      )}
      <CreateIssueDialog
        key={creating ? 'open' : 'closed'}
        open={creating}
        onOpenChange={setCreating}
        status="todo"
        parent={issue}
      />
    </section>
  )
}
