import { useSuspenseQuery } from '@tanstack/react-query'
import { CalendarDays, CircleUserRound, Gauge, GitPullRequestArrow, Goal, IterationCw, Tag, X } from 'lucide-react'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { PersonAvatar } from '@/components/PersonRow'
import { PlanPicker } from '@/features/plans/components/PlanPicker'
import { PlanStatusDot } from '@/features/plans/components/PlanStatusDot'
import { formatDate, localDateISO, timeAgo, timeSince } from '@/lib/format'
import { cn } from '@/lib/utils'
import { workspaceIssuesQuery, type IssueDetail } from '../api'
import { cycleTitle } from '../cycles'
import { useIssueContext, useUpdateIssue } from '../hooks'
import { ESTIMATE_HOURS, hoursLabel, issueIdentifier, priorityLabel, statusLabel } from '../meta'
import type { MenuKind } from '../nav-context'
import { AssigneePicker } from './AssigneePicker'
import { CyclePicker } from './CyclePicker'
import { DueDatePicker } from './DueDatePicker'
import { LabelChip } from './LabelChip'
import { LabelPicker } from './LabelPicker'
import { Picker } from './Picker'
import { PriorityIcon } from './PriorityIcon'
import { PriorityPicker } from './PriorityPicker'
import { RepoPicker } from './RepoPicker'
import { StatusIcon } from './StatusIcon'
import { StatusPicker } from './StatusPicker'
import { GitHubMark } from '@/features/repos/components/GitHubMark'

/** Whole-hour estimate buckets. */
const NONE = 'none'

/**
 * Right-hand properties panel on the issue page. Every property is a menu;
 * changes save at once. `menu` lets keyboard shortcuts open one.
 */
export function IssueProperties({
  issue,
  menu,
  onMenuChange,
}: {
  issue: IssueDetail
  menu: MenuKind | null
  onMenuChange: (menu: MenuKind | null) => void
}) {
  const { workspace, members, labels, cycles, repos, plans, canManage, userId } = useIssueContext()
  const menuFor = (kind: MenuKind) => ({
    open: menu === kind,
    onOpenChange: (open: boolean) => onMenuChange(open ? kind : null),
  })
  const cycle = cycles.find((c) => c.id === issue.cycle_id)
  const plan = plans.find((p) => p.id === issue.plan_id)
  const repo = repos.find((r) => r.id === issue.repo_id)
  const issues = useSuspenseQuery(workspaceIssuesQuery(workspace.id)).data
  const update = useUpdateIssue()
  const [now] = useState(Date.now)

  const assignee = members.find((m) => m.user_id === issue.assignee_id)
  const issueLabels = labels.filter((l) => issue.labelIds.includes(l.id))
  const parent = issues.find((i) => i.id === issue.parent_id)

  // An issue can't move under itself or its own sub-issues.
  const descendants = new Set([issue.id])
  for (let grew = true; grew; ) {
    grew = false
    for (const i of issues) {
      if (i.parent_id && descendants.has(i.parent_id) && !descendants.has(i.id)) {
        descendants.add(i.id)
        grew = true
      }
    }
  }
  const parentOptions = issues.filter((i) => !descendants.has(i.id))

  return (
    <aside aria-label="Properties" className="space-y-1 text-sm">
      <Row label="Status">
        <StatusPicker
          value={issue.status}
          onChange={(status) => update.mutate({ issue, patch: { status } })}
          {...menuFor('status')}
        >
          <Value>
            <StatusIcon status={issue.status} />
            {statusLabel[issue.status]}
          </Value>
        </StatusPicker>
      </Row>
      <Row label="Priority">
        <PriorityPicker
          value={issue.priority}
          onChange={(priority) => update.mutate({ issue, patch: { priority } })}
          {...menuFor('priority')}
        >
          <Value muted={issue.priority === 0}>
            <PriorityIcon priority={issue.priority} />
            {priorityLabel[issue.priority]}
          </Value>
        </PriorityPicker>
      </Row>
      <Row label="Assignee">
        <AssigneePicker
          value={issue.assignee_id}
          members={members}
          userId={userId}
          onChange={(assignee_id) => update.mutate({ issue, patch: { assignee_id } })}
          {...menuFor('assignee')}
        >
          <Value muted={!assignee}>
            {assignee ? (
              <>
                <PersonAvatar profile={assignee.profile} className="size-4" />
                <span className="truncate">{assignee.profile?.display_name ?? 'Unnamed member'}</span>
              </>
            ) : issue.import_assignee ? (
              // Kept by an import until someone is matched (Import issues → People from earlier imports).
              <span className="flex min-w-0 items-center gap-1.5" title="From an import: not matched to anyone in Calsko yet">
                <CircleUserRound className="size-4 shrink-0" />
                <span className="truncate italic">{issue.import_assignee}</span>
              </span>
            ) : (
              <>
                <CircleUserRound className="size-4" /> Unassigned
              </>
            )}
          </Value>
        </AssigneePicker>
      </Row>
      <Row label="Labels">
        <LabelPicker
          workspaceId={workspace.id}
          value={issue.labelIds}
          labels={labels}
          canCreate={canManage}
          onChange={(labelIds) => update.mutate({ issue, labelIds })}
          {...menuFor('label')}
        >
          <Value muted={issueLabels.length === 0} className="h-auto min-h-8 flex-wrap py-1">
            {issueLabels.length === 0 ? (
              <>
                <Tag className="size-4" /> Add label
              </>
            ) : (
              issueLabels.map((l) => <LabelChip key={l.id} label={l} />)
            )}
          </Value>
        </LabelPicker>
      </Row>
      <Row label="Sprint">
        <CyclePicker
          value={issue.cycle_id}
          cycles={cycles}
          onChange={(cycle_id) => update.mutate({ issue, patch: { cycle_id } })}
          {...menuFor('cycle')}
        >
          <Value muted={!cycle}>
            <IterationCw className="size-4" />
            <span className="truncate">{cycle ? cycleTitle(cycle) : 'No sprint'}</span>
          </Value>
        </CyclePicker>
      </Row>
      <Row label="Plan">
        {issue.parent_id ? (
          // A sub-issue is in its parent's plan (the database keeps them together).
          <span className="flex min-w-0 items-center gap-2 px-2 text-sm text-muted-foreground" title="A sub-issue is in its parent’s plan. Change the parent’s plan to move both.">
            {plan ? <PlanStatusDot status={plan.status} /> : <Goal className="size-4" />}
            <span className="truncate">{plan ? plan.name : 'No plan'}</span>
            <span className="shrink-0 text-xs">· from parent</span>
          </span>
        ) : (
          <PlanPicker
            value={issue.plan_id}
            plans={plans}
            onChange={(plan_id) => update.mutate({ issue, patch: { plan_id } })}
            {...menuFor('plan')}
          >
            <Value muted={!plan}>
              {plan ? <PlanStatusDot status={plan.status} /> : <Goal className="size-4" />}
              <span className="truncate">{plan ? plan.name : 'No plan'}</span>
            </Value>
          </PlanPicker>
        )}
      </Row>
      {/* Only where repos are linked (a repo_id always is, so this covers it too). */}
      {repos.length > 0 && (
        <Row label="Repo">
          <RepoPicker
            value={issue.repo_id}
            repos={repos}
            onChange={(repo_id) => update.mutate({ issue, patch: { repo_id } })}
            check={{ workspaceId: workspace.id, issueKey: workspace.issue_key, canEdit: canManage }}
          >
            <Value muted={!repo}>
              <GitHubMark className="size-4" />
              <span className="truncate">{repo ? repo.name : 'No repository'}</span>
            </Value>
          </RepoPicker>
        </Row>
      )}
      <Row label="Estimate">
        <Picker
          placeholder="Set estimate…"
          selected={[issue.estimate === null ? NONE : String(issue.estimate)]}
          onSelect={(v) => update.mutate({ issue, patch: { estimate: v === NONE ? null : Number(v) } })}
          options={[
            { value: NONE, label: 'No estimate' },
            ...ESTIMATE_HOURS.map((e) => ({ value: String(e), label: hoursLabel(e) })),
          ]}
        >
          <Value muted={issue.estimate === null}>
            <Gauge className="size-4" />
            {issue.estimate === null ? 'No estimate' : hoursLabel(issue.estimate)}
          </Value>
        </Picker>
      </Row>
      <Row label="Due date">
        <DueDate
          value={issue.due_date}
          onChange={(due_date) => update.mutate({ issue, patch: { due_date } })}
        />
      </Row>
      <Row label="Parent">
        <Picker
          placeholder="Set parent issue…"
          selected={[issue.parent_id ?? NONE]}
          onSelect={(v) => {
            const parent_id = v === NONE ? null : v
            if (parent_id !== issue.parent_id) update.mutate({ issue, patch: { parent_id } })
          }}
          options={[
            { value: NONE, label: 'No parent' },
            ...parentOptions.map((i) => ({
              value: i.id,
              label: `${issueIdentifier(workspace.issue_key, i.number)} ${i.title}`,
              icon: <StatusIcon status={i.status} />,
            })),
          ]}
        >
          <Value muted={!parent}>
            <GitPullRequestArrow className="size-4" />
            <span className="truncate">
              {parent ? `${issueIdentifier(workspace.issue_key, parent.number)} ${parent.title}` : 'No parent'}
            </span>
          </Value>
        </Picker>
      </Row>
      <p className="px-2 pt-4 text-xs text-muted-foreground">
        Created by {issue.creator?.display_name ?? (issue.error ? 'Error tracking' : 'a former member')} · {timeAgo(issue.created_at, now)}
        <br />
        Updated {timeSince(issue.updated_at, now)}
        {issue.completed_at && (
          <>
            <br />
            Completed {formatDate(issue.completed_at)}
          </>
        )}
      </p>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2">
      <span className="px-2 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** A property value that opens its menu (used as a Picker trigger). */
function Value({ muted, className, children, ...props }: { muted?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none',
        muted && 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

function DueDate({ value, onChange }: { value: string | null; onChange: (date: string | null) => void }) {
  const [today] = useState(() => localDateISO(new Date()))
  const overdue = value !== null && value < today
  return (
    <div className="group/due relative flex items-center">
      <DueDatePicker value={value} onChange={onChange} className="flex-1">
        <Value
          muted={!value}
          aria-label={value ? `Due date: ${formatDate(value)}` : 'Set due date'}
          className={cn(overdue && 'text-red-600 dark:text-red-400')}
        >
          <CalendarDays className={cn('size-4 shrink-0', overdue ? 'text-red-500' : 'text-muted-foreground')} />
          {value ? formatDate(value) : 'Set due date'}
        </Value>
      </DueDatePicker>
      {value && (
        <button
          type="button"
          aria-label="Clear due date"
          onClick={() => onChange(null)}
          className="absolute right-2 text-muted-foreground opacity-0 group-hover/due:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
