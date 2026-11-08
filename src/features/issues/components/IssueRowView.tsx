import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleUserRound, GitBranch, Gauge, IterationCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PersonAvatar } from '@/components/PersonRow'
import type { Plan } from '@/features/plans/api'
import { PlanPicker } from '@/features/plans/components/PlanPicker'
import { PlanStatusDot } from '@/features/plans/components/PlanStatusDot'
import type { Repo } from '@/features/repos/api'
import { GitHubMark } from '@/features/repos/components/GitHubMark'
import type { WorkspaceMember } from '@/features/workspaces/api'
import { formatShortDate, localDateISO } from '@/lib/format'
import { cn } from '@/lib/utils'
import { issueBranchesQuery, type Issue, type IssueCycle, type IssueLabel, type IssuePatch } from '../api'
import { copyBranchName } from '../copyBranch'
import { cycleTitle } from '../cycles'
import { ESTIMATE_HOURS, hoursLabel, isClosed, issueBranchName, issueIdentifier, priorityLabel, statusLabel } from '../meta'
import { useRowNav, type MenuKind } from '../nav-context'
import { AssigneePicker } from './AssigneePicker'
import type { RowNest } from './IssueList'
import { CyclePicker } from './CyclePicker'
import { DueDatePicker } from './DueDatePicker'
import { LabelChip } from './LabelChip'
import { Picker } from './Picker'
import { PriorityIcon } from './PriorityIcon'
import { PriorityPicker } from './PriorityPicker'
import { RepoPicker } from './RepoPicker'
import { StatusIcon } from './StatusIcon'
import { StatusPicker } from './StatusPicker'

/** What a row needs from its project: the lists its chips and menus use, and how to save. */
export type IssueRowSource = {
  href: string
  workspace: { issue_key: string }
  members: WorkspaceMember[]
  labels: IssueLabel[]
  cycles: IssueCycle[]
  repos: Repo[]
  /** The group's plans (one list for the whole group). */
  plans: Plan[]
  userId: string
  update: (patch: IssuePatch) => void
  /** The group-wide page: the project's name, shown as a chip. */
  project?: string
  /** Called when a menu opens (the group-wide page loads that project's lists then). */
  onMenuOpen?: () => void
}

const iconButton =
  'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none'

/** A compact, clickable property chip that sits above the row's stretched title link. */
const chip =
  'relative z-10 hidden shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-[11px] text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none'
const NONE = 'none'

/**
 * One list row, like Linear's: priority · ID · status · title · sub-issue
 * progress … sprint · repo · labels · due date · estimate · assignee · created.
 * The whole row opens the issue (a stretched title link); the properties are
 * menus, and in projects with repos a hover button copies the branch name.
 * Hover or j/k focuses it for keyboard shortcuts (inside an IssueCollection).
 */
export function IssueRowView({
  issue,
  subIssues,
  nest,
  source,
  children,
}: {
  issue: Issue
  subIssues?: { done: number; total: number }
  /** In a nested list: indented by depth, with an arrow that opens its sub-issues. */
  nest?: RowNest
  source: IssueRowSource
  /** Extra menus anchored in the row (the project list's shortcut-only menus). */
  children?: ReactNode
}) {
  const { workspace, members, labels, cycles, repos, plans, userId, update, onMenuOpen } = source
  const queryClient = useQueryClient()
  const nav = useRowNav(issue.id)
  const cycle = cycles.find((c) => c.id === issue.cycle_id)
  const plan = plans.find((p) => p.id === issue.plan_id)
  const repo = repos.find((r) => r.id === issue.repo_id)
  const [today] = useState(() => localDateISO(new Date()))
  const assignee = members.find((m) => m.user_id === issue.assignee_id)
  const issueLabels = labels.filter((l) => issue.labelIds.includes(l.id))
  const id = issueIdentifier(workspace.issue_key, issue.number)

  /** The shortcut-controlled open state, plus `onMenuOpen`. */
  const menu = (kind?: MenuKind) => {
    const controlled = kind ? nav.menuFor(kind) : { open: undefined, onOpenChange: undefined }
    return {
      open: controlled.open,
      onOpenChange: (open: boolean) => {
        if (open) onMenuOpen?.()
        controlled.onOpenChange?.(open)
      },
    }
  }

  return (
    <li
      data-issue-row={issue.id}
      onMouseEnter={nav.focus}
      className={cn(
        'group relative flex h-10 items-center gap-2 px-3 text-sm hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50',
        nav.active && 'bg-muted/60 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand',
      )}
      style={nest?.depth ? { paddingLeft: `${0.75 + nest.depth * 1.5}rem` } : undefined}
    >
      {nest &&
        (nest.onToggle ? (
          <button
            type="button"
            className={cn(iconButton, 'text-muted-foreground')}
            aria-expanded={nest.open}
            aria-label={nest.open ? 'Hide sub-issues' : 'Show sub-issues'}
            title={nest.open ? 'Hide sub-issues' : 'Show sub-issues'}
            onClick={nest.onToggle}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', nest.open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        ))}
      <PriorityPicker value={issue.priority} onChange={(priority) => update({ priority })} {...nav.menuFor('priority')}>
        <button type="button" className={iconButton} aria-label={`Priority: ${priorityLabel[issue.priority]}`}>
          <PriorityIcon priority={issue.priority} />
        </button>
      </PriorityPicker>
      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{id}</span>
      <StatusPicker value={issue.status} onChange={(status) => update({ status })} {...nav.menuFor('status')}>
        <button type="button" className={iconButton} aria-label={`Status: ${statusLabel[issue.status]}`}>
          <StatusIcon status={issue.status} />
        </button>
      </StatusPicker>
      <Link
        to={source.href}
        className={cn(
          'min-w-0 truncate font-medium outline-none after:absolute after:inset-0',
          isClosed(issue.status) && 'text-muted-foreground',
        )}
      >
        {issue.title}
      </Link>
      {subIssues && subIssues.total > 0 && (
        <span
          className="shrink-0 rounded-full border px-1.5 font-mono text-[10px] text-muted-foreground"
          title={`${subIssues.done} of ${subIssues.total} sub-issues done`}
        >
          {subIssues.done}/{subIssues.total}
        </span>
      )}
      {repos.length > 0 && (
        <button
          type="button"
          className={cn(
            iconButton,
            'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
            nav.active && 'opacity-100',
          )}
          aria-label="Copy branch name"
          title="Copy branch name"
          // The branch it has (one request, on click), else the name it would get.
          onClick={() =>
            void copyBranchName(
              queryClient
                .fetchQuery({ ...issueBranchesQuery(issue.id), staleTime: 0 })
                .then((branches) => branches[0]?.name ?? issueBranchName(workspace.issue_key, issue.number, issue.title)),
            )
          }
        >
          <GitBranch className="size-3.5" />
        </button>
      )}
      <span className="flex-1" />
      {plan &&
        (issue.parent_id ? (
          // A sub-issue is in its parent's plan: shown, not chosen here.
          <span className={cn(chip, 'max-w-40 font-sans lg:flex')} title={`Plan: ${plan.name} (from its parent)`}>
            <PlanStatusDot status={plan.status} className="size-2" />
            <span className="truncate">{plan.name}</span>
          </span>
        ) : (
          <PlanPicker value={issue.plan_id} plans={plans} align="end" onChange={(plan_id) => update({ plan_id })} {...menu('plan')}>
            <button type="button" className={cn(chip, 'max-w-40 font-sans lg:flex')} title={`Plan: ${plan.name}`} aria-label={`Plan: ${plan.name}`}>
              <PlanStatusDot status={plan.status} className="size-2" />
              <span className="truncate">{plan.name}</span>
            </button>
          </PlanPicker>
        ))}
      {cycle && (
        <CyclePicker value={issue.cycle_id} cycles={cycles} align="end" onChange={(cycle_id) => update({ cycle_id })} {...menu()}>
          <button type="button" className={cn(chip, 'lg:flex')} title={cycleTitle(cycle)} aria-label={`Sprint: ${cycleTitle(cycle)}`}>
            <IterationCw className="size-3" />
            {cycle.number}
          </button>
        </CyclePicker>
      )}
      {repo && (
        <RepoPicker value={issue.repo_id} repos={repos} align="end" onChange={(repo_id) => update({ repo_id })}>
          <button
            type="button"
            className={cn(chip, 'max-w-32 lg:flex')}
            title={`Repository: ${repo.owner}/${repo.name}`}
            aria-label={`Repository: ${repo.name}`}
          >
            <GitHubMark className="size-3 shrink-0" />
            <span className="truncate">{repo.name}</span>
          </button>
        </RepoPicker>
      )}
      {source.project && (
        <span
          className="hidden max-w-36 shrink-0 truncate rounded-full border px-2 text-[11px] text-muted-foreground xl:inline"
          title={`Project: ${source.project}`}
        >
          {source.project}
        </span>
      )}
      <span className="hidden items-center gap-1 md:flex">
        {issueLabels.slice(0, 2).map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
        {issueLabels.length > 2 && (
          <span className="font-mono text-[11px] text-muted-foreground">+{issueLabels.length - 2}</span>
        )}
      </span>
      {issue.due_date && (
        <DueDatePicker value={issue.due_date} onChange={(due_date) => update({ due_date })}>
          <button
            type="button"
            aria-label={`Due date: ${formatShortDate(issue.due_date!)}`}
            className={cn(
              'relative z-10 hidden shrink-0 items-center rounded-sm border px-1.5 font-mono text-[11px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none sm:inline-flex',
              !isClosed(issue.status) && issue.due_date! < today
                ? 'border-red-500/40 text-red-600 dark:text-red-400'
                : 'text-muted-foreground',
            )}
          >
            {formatShortDate(issue.due_date!)}
          </button>
        </DueDatePicker>
      )}
      {issue.estimate !== null && (
        <Picker
          placeholder="Set estimate…"
          align="end"
          selected={[String(issue.estimate)]}
          onSelect={(v) => update({ estimate: v === NONE ? null : Number(v) })}
          options={[
            { value: NONE, label: 'No estimate' },
            ...ESTIMATE_HOURS.map((e) => ({ value: String(e), label: hoursLabel(e) })),
          ]}
        >
          <button type="button" className={cn(chip, 'sm:flex')} aria-label={`Estimate: ${hoursLabel(issue.estimate)}`}>
            <Gauge className="size-3" />
            {issue.estimate}h
          </button>
        </Picker>
      )}
      <AssigneePicker
        value={issue.assignee_id}
        members={members}
        userId={userId}
        align="end"
        onChange={(assignee_id) => update({ assignee_id })}
        {...menu('assignee')}
      >
        <button
          type="button"
          className={iconButton}
          aria-label={assignee ? `Assignee: ${assignee.profile?.display_name ?? 'member'}` : issue.import_assignee ? `Imported assignee: ${issue.import_assignee}, not matched yet` : 'Assign'}
          title={!assignee && issue.import_assignee ? `${issue.import_assignee} (from an import, not matched yet)` : undefined}
        >
          {assignee ? (
            <PersonAvatar profile={assignee.profile} className="size-5" />
          ) : issue.import_assignee ? (
            // Kept by an import until someone is matched: their initial in a dashed circle.
            <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-[10px] text-muted-foreground uppercase">
              {issue.import_assignee.trim()[0]}
            </span>
          ) : (
            <CircleUserRound className="size-4 text-muted-foreground/70" />
          )}
        </button>
      </AssigneePicker>
      <span className="hidden w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground sm:block">
        {formatShortDate(issue.created_at)}
      </span>
      {children}
    </li>
  )
}
