import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Suspense, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PersonAvatar } from '@/components/PersonRow'
import { courseOverviewLearning } from '@/features/learning/screens'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { workspacePath } from '@/features/teams/nav'
import { workspaceRoleLabel, workspaceTypes } from '@/features/teams/permissions'
import { workspaceMembersQuery, type WorkspaceMember } from '@/features/workspaces/api'
import { formatDate, timeAgo } from '@/lib/format'

const PREVIEW = 6
const ACTIVITY = 5

/**
 * Workspace overview: what this workspace is and what's happening in it.
 * The enabled tools are already the tabs above, so they aren't listed again.
 * Continue learning shows the student's next lesson (the teacher's shortcuts); Active issues is still a placeholder.
 */
export function WorkspaceOverviewPage() {
  const { team } = useCurrentTeam()
  const { workspace, can } = useCurrentWorkspace()
  const members = useSuspenseQuery(workspaceMembersQuery(workspace.id)).data
  const base = workspacePath(team.slug, workspace.id)
  const enabled = new Set(workspace.modules)

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-10">
        <Section title="About">
          {workspace.description ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{workspace.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No description yet.
              {can.canEdit && (
                <>
                  {' '}
                  <Link to={`${base}/settings`} className="underline underline-offset-4 hover:text-foreground">
                    Add one
                  </Link>
                </>
              )}
            </p>
          )}
        </Section>

        {enabled.has('learning') && (
          <Section title={can.canEdit ? 'Course' : 'Continue learning'} action={<TabLink to={`${base}/learning`}>Learning</TabLink>}>
            <Suspense fallback={<div className="h-20 animate-pulse rounded-lg bg-muted" />}>
              <courseOverviewLearning.Component />
            </Suspense>
          </Section>
        )}

        {enabled.has('issues') && (
          <Section title="Active issues" action={<TabLink to={`${base}/issues`}>Issues</TabLink>}>
            <EmptyState>No open issues. Once Issues is built, open and in-progress work will be listed here.</EmptyState>
          </Section>
        )}

        <RecentActivity members={members} />
      </div>

      <aside className="space-y-8 xl:border-l xl:pl-6">
        <PeopleRail members={members} base={base} />

        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold">Details</h2>
          <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Type</dt>
            <dd>{workspaceTypes[workspace.type].label}</dd>
            <dt className="text-muted-foreground">Group</dt>
            <dd className="truncate">{team.name}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-mono text-xs leading-5">{formatDate(workspace.created_at)}</dd>
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="font-mono text-xs leading-5">{formatDate(workspace.updated_at)}</dd>
          </dl>
        </section>
      </aside>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="border-y py-6 text-sm text-muted-foreground">{children}</p>
}

function TabLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {children} <ArrowRight className="size-3" />
    </Link>
  )
}

/** Built from what we already have (creation + member joins); tool activity comes later. */
function RecentActivity({ members }: { members: WorkspaceMember[] }) {
  const { workspace } = useCurrentWorkspace()
  const [now] = useState(Date.now)
  const events = [
    ...members.map((m) => ({
      key: m.user_id,
      at: m.joined_at,
      profile: m.profile,
      text: (
        <>
          <span className="font-medium">{m.profile?.display_name ?? 'Unnamed member'}</span>
          <span className="text-muted-foreground"> joined as {workspaceRoleLabel[m.role].toLowerCase()}</span>
        </>
      ),
    })),
    {
      key: 'created',
      at: workspace.created_at,
      profile: undefined,
      text: <span className="text-muted-foreground">{workspaceTypes[workspace.type].label} created</span>,
    },
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY)

  return (
    <Section title="Recent activity">
      <ul className="divide-y border-y">
        {events.map((event) => (
          <li key={event.key} className="flex items-center gap-2.5 px-1 py-2 text-sm">
            {event.profile !== undefined ? (
              <PersonAvatar profile={event.profile} />
            ) : (
              <span className="size-6 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{event.text}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{timeAgo(event.at, now)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Activity from tools (docs, lessons, meetings) will show up here later.</p>
    </Section>
  )
}

/** Lead(s), then members: compact, with a link to the full list. */
function PeopleRail({ members, base }: { members: WorkspaceMember[]; base: string }) {
  const leads = members.filter((m) => m.role === 'lead')
  const rest = members.filter((m) => m.role !== 'lead')
  const shownRest = rest.slice(0, Math.max(0, PREVIEW - leads.length))

  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">People</h2>
        <span className="font-mono text-xs text-muted-foreground">{members.length}</span>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has been added yet.</p>
      ) : (
        <div className="space-y-3">
          <PeopleGroup label={leads.length === 1 ? 'Lead' : 'Leads'} people={leads} empty="No lead yet" />
          {rest.length > 0 && <PeopleGroup label="Members" count={rest.length} people={shownRest} />}
        </div>
      )}
      <Link to={`${base}/members`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {members.length > PREVIEW ? `All ${members.length} members` : 'Manage members'} <ArrowRight className="size-3" />
      </Link>
    </section>
  )
}

function PeopleGroup({
  label,
  count,
  people,
  empty,
}: {
  label: string
  count?: number
  people: WorkspaceMember[]
  empty?: string
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
        {count !== undefined && ` · ${count}`}
      </p>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {people.map((member) => (
            <li key={member.user_id} className="flex items-center gap-2 text-sm">
              <PersonAvatar profile={member.profile} />
              <span className="min-w-0 flex-1 truncate">{member.profile?.display_name ?? 'Unnamed member'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
