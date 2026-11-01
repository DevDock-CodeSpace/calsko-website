import { Bug, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useIssueContext } from '@/features/issues/hooks'
import { issueIdentifier } from '@/features/issues/meta'
import { useCurrentTeam } from '@/features/teams/hooks'
import { workspacePath } from '@/features/teams/nav'
import { formatShortDate, timeAgo } from '@/lib/format'
import type { IssueError } from '../embed'

const DAYS = 14

/** The tracker's name from the error's link, for "Open in PostHog". */
function trackerName(url: string): string {
  const host = new URL(url).hostname
  if (host.endsWith('posthog.com')) return 'PostHog'
  if (host.endsWith('sentry.io')) return 'Sentry'
  return host.replace(/^www\./, '')
}

/** The last 14 UTC days, oldest first, with zeros for quiet days. */
function lastDays(days: IssueError['days'], now: number) {
  const counts = new Map(days.map((d) => [d.day, d.count]))
  return Array.from({ length: DAYS }, (_, i) => {
    const day = new Date(now - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return { day, count: counts.get(day) ?? 0 }
  })
}

/**
 * Under the properties, for issues made by error tracking: how often the error happened, first and
 * last seen, the last 14 days and a link back to the tracker. Counts are refreshed once a day.
 * Rides on the issue query (no request of its own).
 */
export function IssueErrorBlock({ error }: { error: IssueError }) {
  const { team } = useCurrentTeam()
  const { workspace } = useIssueContext()
  const [now] = useState(Date.now)
  const days = lastDays(error.days, now)
  const max = Math.max(1, ...days.map((d) => d.count))
  const recent = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <section aria-label="Error" className="mt-6 space-y-2 border-t pt-4">
      <h2 className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
        <Bug className="size-3.5" /> Error
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 text-xs">
        <dt className="text-muted-foreground">Seen</dt>
        <dd className="font-mono">
          {error.total_count.toLocaleString()} {error.total_count === 1 ? 'time' : 'times'}
        </dd>
        <dt className="text-muted-foreground">First</dt>
        <dd className="font-mono" title={new Date(error.first_seen).toLocaleString()}>
          {formatShortDate(error.first_seen)}
        </dd>
        <dt className="text-muted-foreground">Last</dt>
        <dd className="font-mono" title={new Date(error.last_seen).toLocaleString()}>
          {timeAgo(error.last_seen, now)}
        </dd>
      </dl>

      <div className="px-2">
        <div
          role="img"
          aria-label={`${recent} in the last ${DAYS} days`}
          title={`${recent.toLocaleString()} in the last ${DAYS} days`}
          className="flex h-8 items-end gap-px"
        >
          {days.map((d) => (
            <span
              key={d.day}
              title={`${d.day}: ${d.count.toLocaleString()}`}
              className={d.count ? 'flex-1 rounded-[1px] bg-red-500/70 dark:bg-red-400/70' : 'flex-1 rounded-[1px] bg-muted'}
              style={{ height: d.count ? `${Math.max(12, (d.count / max) * 100)}%` : '2px' }}
            />
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Last {DAYS} days · updated daily</p>
      </div>

      {error.previous && (
        <Link
          to={`${workspacePath(team.slug, workspace.id)}/issues/${error.previous.number}`}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Came back after <span className="font-mono">{issueIdentifier(workspace.issue_key, error.previous.number)}</span>
        </Link>
      )}
      {error.url && (
        <a
          href={error.url}
          target="_blank"
          rel="noreferrer"
          className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-3.5 shrink-0" /> Open in {trackerName(error.url)}
        </a>
      )}
    </section>
  )
}
