import { useMutation, useQuery, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { CalendarDays, ChevronDown, FileText, FolderOpen, MoreHorizontal, PanelRight, Plus, Presentation, Trash2, UserRound, X } from 'lucide-react'
import { Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/hooks'
import { createDiagram, teamDiagramsQuery } from '@/features/diagrams/api'
import { createDocument, teamDocsQuery } from '@/features/docs/api'
import { teamIssuesQuery, type IssueStatus, type TeamIssue } from '@/features/issues/api'
import { DueDatePicker } from '@/features/issues/components/DueDatePicker'
import type { CreateIssueDialogProps } from '@/features/issues/components/CreateIssueDialog'
import type { HubProject } from '@/features/issues/hub/hooks'
import { StarButton } from '@/features/issues/components/StarButton'
import { TeamIssueRow } from '@/features/issues/components/TeamIssueRow'
import { useHubProjects } from '@/features/issues/hub/hooks'
import { useUpdateTeamIssue } from '@/features/issues/hooks'
import { compareIssues, isClosed, issueIdentifier, statusLabel } from '@/features/issues/meta'
import { planFiles, planKeys, planQuery, teamPlansQuery, type Plan, type PlanDetail, type PlanStatus } from '@/features/plans/api'
import { FileStack, NewFileButton, type StackItem } from '@/features/plans/components/FileStack'
import { PlanProjectPickerDialog } from '@/features/plans/components/PlanProjectPickerDialog'
import { PlanStatusDot } from '@/features/plans/components/PlanStatusDot'
import { ProgressRing } from '@/features/plans/components/ProgressRing'
import { useDeletePlan, useOpenPlanWhiteboard, useUpdatePlan } from '@/features/plans/hooks'
import { PLAN_STATUS_ORDER, planStatusLabel, planStatusTile } from '@/features/plans/meta'
import { planProgress } from '@/features/plans/progress'
import { teamMembersQuery, type TeamMember } from '@/features/teams/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { diagramPath, docPath, filesPath, hubPlansPath, issuePath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'
import { formatShortDate, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { preloadable } from '@/lib/preloadable'

const PlanCreateIssueDialog = preloadable<CreateIssueDialogProps & { project: HubProject }>(() =>
  import('@/features/issues/components/CreateIssueDialogForWorkspace').then((module) => ({
    default: module.CreateIssueDialogForWorkspace,
  })),
)

/** A quiet property value in the details panel: text that turns into a button for editors. */
const chip =
  '-ml-2 inline-flex h-7 max-w-full items-center whitespace-nowrap gap-1.5 rounded-md px-2 text-sm transition-colors enabled:hover:bg-muted disabled:cursor-default'

/** The details panel's status bar: open work first, done last; canceled issues aren't counted. */
const BAR: [IssueStatus, string][] = [
  ['backlog', 'bg-muted-foreground/40'],
  ['todo', 'bg-muted-foreground/70'],
  ['in_progress', 'bg-amber-500'],
  ['in_review', 'bg-violet-500'],
  ['done', 'bg-brand'],
]

/**
 * Issues hub → a plan (Graphite design, owner's choice 2026-10-27): its files as a horizontal 3D stack
 * (the Brief, the Whiteboard and whatever else is in its folder in Files), the issues nobody has taken
 * yet (Up for grabs, with Assign to me), its issues by person, and a details panel on the right
 * (progress, status, lead, dates, people, projects) that closes with ✕; it starts open and the choice
 * isn't remembered. Its lead, its creator and group owners/admins edit and delete it; everyone in the
 * group edits its files. Everything comes from the hub's cached lists plus the plan itself: no extra
 * request beyond `planLoader`'s.
 */
export function PlanPage() {
  const { planId = '' } = useParams()
  const { user } = useAuth()
  const { team, can } = useCurrentTeam()
  const [{ data: plan }, { data: issues }, { data: people }, { data: plans }] = useSuspenseQueries({
    queries: [planQuery(planId), teamIssuesQuery(team.id), teamMembersQuery(team.id), teamPlansQuery(team.id)],
  })
  if (!plan) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        This plan was deleted. <Link to={hubPlansPath(team.slug)} className="underline">See all plans</Link>
      </p>
    )
  }
  return (
    <PlanDetails
      key={plan.id}
      plan={plan}
      issues={issues.filter((i) => i.plan_id === plan.id)}
      people={people}
      plans={plans}
      canEdit={plan.lead_id === user.id || plan.created_by === user.id || can.isAdmin}
    />
  )
}

function PlanDetails({ plan, issues, people, plans, canEdit }: { plan: PlanDetail; issues: TeamIssue[]; people: TeamMember[]; plans: Plan[]; canEdit: boolean }) {
  const { user } = useAuth()
  const { team } = useCurrentTeam()
  const navigate = useNavigate()
  const projects = useHubProjects()
  const update = useUpdatePlan(team.id)
  const updateIssue = useUpdateTeamIssue(team.id)
  const [name, setName] = useState(plan.name)
  const [confirming, setConfirming] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [issueWorkspaceId, setIssueWorkspaceId] = useState<string | null>(null)
  const [newIssueOpen, setNewIssueOpen] = useState(false)

  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ planId: plan.id, patch })
  const startNewIssue = () => {
    if (projects.length === 1) {
      setIssueWorkspaceId(projects[0].id)
      setNewIssueOpen(true)
    } else {
      setProjectPickerOpen(true)
    }
  }
  const chooseProject = (workspaceId: string) => {
    setProjectPickerOpen(false)
    setIssueWorkspaceId(workspaceId)
    setNewIssueOpen(true)
  }
  const issueProject = projects.find((project) => project.id === issueWorkspaceId)
  const lead = people.find((p) => p.user_id === plan.lead_id)
  const free = issues.filter((i) => !i.assignee_id && !isClosed(i.status)).sort(compareIssues)
  const canTake = (issue: TeamIssue) => projects.find((p) => p.id === issue.workspace.id)?.canTake ?? false
  // Projects whose free issues the caller can't take, said once above the list.
  const outside = [...new Set(free.filter((i) => !canTake(i)).map((i) => i.workspace.title))]
  const showProject = projects.length > 1
  const byPerson = new Map<string, TeamIssue[]>()
  for (const issue of issues) if (issue.assignee_id) byPerson.set(issue.assignee_id, [...(byPerson.get(issue.assignee_id) ?? []), issue])

  const [panelOpen, setPanelOpen] = useState(true)
  const subtitle = [
    `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`,
    plan.target_on && `target ${formatShortDate(plan.target_on)}`,
    lead && `led by ${lead.profile?.display_name ?? 'a member'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-8 pb-16 lg:flex-row lg:gap-0">
      <div className="min-w-0 flex-1 space-y-8 lg:pr-6">
        <div className="flex items-start gap-3">
          <span className={cn('mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl', planStatusTile[plan.status])}>
            <PlanStatusDot status={plan.status} className="size-3" />
          </span>
          <div className="min-w-0 flex-1">
            {canEdit ? (
              <input
                aria-label="Plan name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => (name.trim() && name.trim() !== plan.name ? save({ name }) : setName(plan.name))}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="-ml-1 w-full rounded-md bg-transparent px-1 text-[26px] leading-tight font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            ) : (
              <h2 className="truncate text-[26px] leading-tight font-semibold tracking-tight">{plan.name}</h2>
            )}
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-1">
            <StarButton target={{ kind: 'plan', planId: plan.id }} label={plan.name} />
            {projects.length > 0 && <Button size="sm" onClick={startNewIssue}><Plus /> New issue</Button>}
            {!panelOpen && (
              <Button size="icon-sm" variant="ghost" aria-label="Show details" title="Show details" className="hidden lg:inline-flex" onClick={() => setPanelOpen(true)}>
                <PanelRight />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Plan options">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {plan.folder_id && (
                  <DropdownMenuItem onSelect={() => void navigate(filesPath(team.slug, undefined, { folder: plan.folder_id }))}>
                    <FolderOpen /> Open its folder in Files
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                      <Trash2 /> Delete plan…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <PlanFiles plan={plan} />

        <section aria-labelledby="up-for-grabs">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1.5">
            <h3 id="up-for-grabs" className="text-sm font-semibold">
              Up for grabs <span className="font-mono text-xs font-normal text-muted-foreground">{free.length}</span>
            </h3>
            {outside.length > 0 && <span className="text-xs text-muted-foreground">You’re not in {outside.join(', ')}: ask a lead to add you to take these.</span>}
          </div>
          {free.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting: every open issue has someone.</p>
          ) : (
            <ul className="divide-y">
              {free.map((issue) => (
                <li key={issue.id} className="flex h-10 items-center gap-3">
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{issueIdentifier(issue.workspace.issue_key, issue.number)}</span>
                  <Link to={issuePath(team.slug, issue.workspace.id, issue.number)} className="min-w-0 flex-1 truncate text-sm hover:underline">
                    {issue.title}
                  </Link>
                  {showProject && <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{issue.workspace.title}</span>}
                  {canTake(issue) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      disabled={updateIssue.isPending}
                      onClick={() =>
                        updateIssue.mutate(
                          { issue, patch: { assignee_id: user.id } },
                          { onSuccess: () => toast.success(`${issueIdentifier(issue.workspace.issue_key, issue.number)} is yours`) },
                        )
                      }
                    >
                      <UserRound /> Assign to me
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="plan-people">
          <h3 id="plan-people" className="border-b pb-1.5 text-sm font-semibold">
            Who is doing what
          </h3>
          {byPerson.size === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {issues.length === 0 ? 'No issues in this plan yet. Use New issue, or set the plan on issues from their page.' : 'Nobody has taken an issue from this plan yet.'}
            </p>
          ) : (
            <div className="mt-3 space-y-5">
              {[...byPerson].map(([id, list]) => {
                const who = people.find((p) => p.user_id === id)
                const done = list.filter((i) => i.status === 'done').length
                return (
                  <div key={id}>
                    <div className="flex items-center gap-2 pb-1 text-xs">
                      <PersonAvatar profile={who?.profile ?? list[0].assignee} className="size-4" />
                      <span className="font-medium">{who?.profile?.display_name ?? list[0].assignee?.display_name ?? 'Former member'}</span>
                      <span className="font-mono text-muted-foreground">
                        {done}/{list.length}
                      </span>
                    </div>
                    <div className="border-y">
                      {[...list].sort(compareIssues).map((issue) => (
                        <TeamIssueRow
                          key={issue.id}
                          issue={issue}
                          teamSlug={team.slug}
                          userId={user.id}
                          showProject={showProject}
                          plans={plans}
                          update={(i, patch) => updateIssue.mutate({ issue: i, patch })}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {panelOpen && (
        <PlanDetailsPanel
          plan={plan}
          issues={issues}
          people={people}
          canEdit={canEdit}
          save={save}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {confirming && <DeletePlanDialog plan={plan} issueCount={issues.length} onClose={() => setConfirming(false)} />}
      {projects.length > 1 && (
        <PlanProjectPickerDialog
          projects={projects}
          open={projectPickerOpen}
          onOpenChange={setProjectPickerOpen}
          onSelect={chooseProject}
        />
      )}
      {issueProject && (
        <Suspense
          fallback={
            <Dialog open={newIssueOpen} onOpenChange={setNewIssueOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New issue</DialogTitle>
                  <DialogDescription>Loading project details…</DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          }
        >
          <PlanCreateIssueDialog.Component
            key={`${issueProject.id}-${newIssueOpen ? 'open' : 'closed'}`}
            project={issueProject}
            open={newIssueOpen}
            planId={plan.id}
            onOpenChange={setNewIssueOpen}
          />
        </Suspense>
      )}
    </div>
  )
}

/** The plan's properties beside the page (closable; starts open, not remembered). */
function PlanDetailsPanel({
  plan,
  issues,
  people,
  canEdit,
  save,
  onClose,
}: {
  plan: PlanDetail
  issues: TeamIssue[]
  people: TeamMember[]
  canEdit: boolean
  save: (patch: Partial<Pick<Plan, 'status' | 'lead_id' | 'starts_on' | 'target_on'>>) => void
  onClose: () => void
}) {
  const progress = planProgress(issues)
  const lead = people.find((p) => p.user_id === plan.lead_id)
  const counted = issues.filter((i) => i.status !== 'canceled')
  const working = [...new Map(issues.filter((i) => i.assignee_id).map((i) => [i.assignee_id, people.find((p) => p.user_id === i.assignee_id)?.profile ?? i.assignee])).values()]
  const projects = [...new Map(issues.map((i) => [i.workspace.id, i.workspace.title])).values()].sort()

  return (
    <aside aria-label="Plan details" className="shrink-0 border-t pt-6 lg:sticky lg:top-0 lg:w-[300px] lg:self-start lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Details</h3>
        <Button size="icon-sm" variant="ghost" aria-label="Close details" title="Close details" className="hidden lg:inline-flex" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <ProgressRing ratio={progress.ratio} size={76} stroke={6}>
          <span className="font-mono text-base font-semibold">{Math.round(progress.ratio * 100)}%</span>
        </ProgressRing>
        <div className="text-sm">
          {progress.total === 0 ? (
            <p className="text-muted-foreground">No issues yet</p>
          ) : (
            <>
              <p className="font-medium">
                {progress.done} of {progress.total} done
              </p>
              <p className="text-muted-foreground">{progress.total - progress.done} still open</p>
            </>
          )}
        </div>
      </div>

      {counted.length > 0 && (
        <div className="mt-4">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
            {BAR.map(([status, color]) => {
              const n = counted.filter((i) => i.status === status).length
              return n > 0 && <span key={status} className={color} style={{ width: `${(n / counted.length) * 100}%` }} title={`${statusLabel[status]}: ${n}`} />
            })}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {BAR.map(([status, color]) => {
              const n = counted.filter((i) => i.status === status).length
              return (
                n > 0 && (
                  <li key={status} className="flex items-center gap-1.5">
                    <span className={cn('size-1.5 rounded-full', color)} /> {statusLabel[status]} <span className="font-mono">{n}</span>
                  </li>
                )
              )
            })}
          </ul>
        </div>
      )}

      <dl className="mt-6 grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={!canEdit}>
              <button type="button" className={chip} aria-label={`Status: ${planStatusLabel[plan.status]}`}>
                <PlanStatusDot status={plan.status} /> {planStatusLabel[plan.status]}
                {canEdit && <ChevronDown className="size-3 opacity-50" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {PLAN_STATUS_ORDER.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => s !== plan.status && save({ status: s as PlanStatus })}>
                  <PlanStatusDot status={s} /> {planStatusLabel[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </dd>
        <dt className="text-muted-foreground">Lead</dt>
        <dd className="min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={!canEdit}>
              <button type="button" className={cn(chip, !lead && 'text-muted-foreground')} aria-label={lead ? `Lead: ${lead.profile?.display_name ?? 'member'}` : 'No lead'}>
                {lead ? <PersonAvatar profile={lead.profile} className="size-4" /> : <UserRound className="size-3.5" />}
                <span className="truncate">{lead ? (lead.profile?.display_name ?? 'Member') : 'No lead'}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuItem onSelect={() => plan.lead_id && save({ lead_id: null })}>
                <UserRound /> No lead
              </DropdownMenuItem>
              {people.map((p) => (
                <DropdownMenuItem key={p.user_id} onSelect={() => p.user_id !== plan.lead_id && save({ lead_id: p.user_id })}>
                  <PersonAvatar profile={p.profile} className="size-4" /> {p.profile?.display_name ?? 'Member'}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </dd>
        <dt className="text-muted-foreground">Start</dt>
        <dd>
          <DateChip label="Start" value={plan.starts_on} canEdit={canEdit} onChange={(starts_on) => save({ starts_on })} />
        </dd>
        <dt className="text-muted-foreground">Target</dt>
        <dd>
          <DateChip label="Target" value={plan.target_on} canEdit={canEdit} onChange={(target_on) => save({ target_on })} />
        </dd>
        <dt className="self-start pt-1 text-muted-foreground">People</dt>
        <dd className="py-1">
          {working.length === 0 ? (
            <span className="text-muted-foreground">Nobody yet</span>
          ) : (
            <span className="flex flex-wrap -space-x-1.5">
              {working.map((profile, i) => (
                <span key={i} title={profile?.display_name ?? 'Member'} className="rounded-full ring-2 ring-background">
                  <PersonAvatar profile={profile} className="size-6" />
                </span>
              ))}
            </span>
          )}
        </dd>
        <dt className="self-start pt-1 text-muted-foreground">Projects</dt>
        <dd className="py-1">
          {projects.length === 0 ? <span className="text-muted-foreground">None yet</span> : <span className="block space-y-1">{projects.map((t) => <span key={t} className="block truncate">{t}</span>)}</span>}
        </dd>
      </dl>
    </aside>
  )
}

function DateChip({ label, value, canEdit, onChange }: { label: string; value: string | null; canEdit: boolean; onChange: (date: string | null) => void }) {
  const text = value ? formatShortDate(value) : 'Not set'
  if (!canEdit) {
    return (
      <span className={cn(chip, !value && 'text-muted-foreground')}>
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" /> {text}
      </span>
    )
  }
  return (
    <DueDatePicker value={value} onChange={onChange}>
      <button type="button" className={cn(chip, !value && 'text-muted-foreground')} aria-label={`${label} date: ${text}`}>
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" /> {text}
      </button>
    </DueDatePicker>
  )
}

/** The plan's files as the 3D stack: its Brief first (4 lines of it), its Whiteboard, then the rest of its folder. */
function PlanFiles({ plan }: { plan: PlanDetail }) {
  const { team } = useCurrentTeam()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [{ data: docs }, { data: boards }] = useSuspenseQueries({ queries: [teamDocsQuery(team.id), teamDiagramsQuery(team.id)] })
  const openBoard = useOpenPlanWhiteboard(team.id)
  const [now] = useState(Date.now)
  const create = useMutation({
    mutationFn: async (kind: 'doc' | 'diagram') => {
      const input = { teamId: team.id, workspaceId: null, folderId: plan.folder_id, title: kind === 'doc' ? 'Untitled doc' : 'Untitled whiteboard' }
      const { id } = kind === 'doc' ? await createDocument(input) : await createDiagram(input)
      return { kind, id }
    },
    onSuccess: ({ kind, id }) => {
      void queryClient.invalidateQueries({ queryKey: [kind === 'doc' ? 'documents' : 'diagrams', 'team', team.id] })
      void navigate(kind === 'doc' ? docPath(team.slug, id) : diagramPath(team.slug, id))
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (!plan.folder_id) return null
  const brief = docs.find((d) => d.id === plan.brief_id)
  const board = boards.find((b) => b.id === plan.whiteboard_id)
  const updated = (at: string) => `updated ${timeAgo(at, now)}`
  // Enough text for 4 lines; the card cuts it there (owner's choice) and the rest is one click away.
  const preview = plan.brief?.content.trim().replace(/\s+/g, ' ').slice(0, 600) || undefined
  const items: StackItem[] = [
    ...(plan.brief_id ? [{ key: plan.brief_id, kind: 'brief' as const, title: brief?.title ?? 'Brief', preview, meta: updated(plan.brief?.updated_at ?? brief?.updated_at ?? plan.updated_at), to: docPath(team.slug, plan.brief_id) }] : []),
    ...(board ? [{ key: board.id, kind: 'whiteboard' as const, title: board.title, meta: updated(board.updated_at), to: diagramPath(team.slug, board.id) }] : []),
    ...[
      ...docs.filter((d) => d.folder_id === plan.folder_id && d.id !== plan.brief_id).map((d) => ({ key: d.id, kind: 'doc' as const, title: d.title, meta: updated(d.updated_at), to: docPath(team.slug, d.id), at: d.updated_at })),
      ...boards.filter((b) => b.folder_id === plan.folder_id && b.id !== plan.whiteboard_id).map((b) => ({ key: b.id, kind: 'whiteboard' as const, title: b.title, meta: updated(b.updated_at), to: diagramPath(team.slug, b.id), at: b.updated_at })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
  ]
  if (items.length === 0) return null

  return (
    <FileStack
      items={items}
      extra={
        !board && (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={openBoard.isPending}
            onClick={() => openBoard.mutate(plan.id, { onSuccess: (id) => void navigate(diagramPath(team.slug, id)) })}
          >
            <Presentation className="size-3.5" /> Start the whiteboard
          </button>
        )
      }
      newMenu={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <NewFileButton disabled={create.isPending} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => create.mutate('doc')}>
              <FileText /> Doc
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => create.mutate('diagram')}>
              <Presentation /> Whiteboard
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  )
}

/** The warning says what goes: the plan and everything in its folder. Its issues stay. */
function DeletePlanDialog({ plan, issueCount, onClose }: { plan: PlanDetail; issueCount: number; onClose: () => void }) {
  const { team } = useCurrentTeam()
  const navigate = useNavigate()
  const remove = useDeletePlan(team.id)
  // Counted when the warning opens (one request), so it names what will go.
  const files = useQuery({ queryKey: [...planKeys.detail(plan.id), 'files'], queryFn: () => planFiles(plan.id), staleTime: 0 }).data
  const parts = files
    ? [
        files.docIds.length > 0 && `${files.docIds.length} ${files.docIds.length === 1 ? 'doc' : 'docs'} (with the Brief)`,
        files.whiteboards > 0 && `${files.whiteboards} ${files.whiteboards === 1 ? 'whiteboard' : 'whiteboards'}`,
        files.folders > 0 && `${files.folders} ${files.folders === 1 ? 'folder' : 'folders'}`,
      ].filter(Boolean)
    : []

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete “${plan.name}” and its files?`}
      description={`This deletes the plan and everything in its folder in Files${parts.length ? `: ${parts.join(', ')}` : ''}. It can’t be undone.${issueCount > 0 ? ` Its ${issueCount === 1 ? 'issue stays' : `${issueCount} issues stay`} in their projects, without a plan.` : ''}`}
      confirmLabel="Delete plan and files"
      pending={remove.isPending || !files}
      onConfirm={() =>
        remove
          .mutateAsync(plan.id)
          .then(() => {
            toast.success('Plan and its files deleted')
            void navigate(hubPlansPath(team.slug))
          })
          .catch((error: unknown) => toast.error(errorMessage(error)))
      }
    />
  )
}
