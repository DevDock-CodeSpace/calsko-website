import { Check, CircleHelp, Clock, X } from 'lucide-react'
import { PersonAvatar } from '@/components/PersonRow'
import { cn } from '@/lib/utils'
import type { Rsvp, RsvpStatus } from '../api'

const order: RsvpStatus[] = ['accepted', 'tentative', 'needsAction', 'declined']

const look: Record<RsvpStatus, { label: string; icon: typeof Check; className: string }> = {
  accepted: { label: 'Going', icon: Check, className: 'text-emerald-600 dark:text-emerald-400' },
  tentative: { label: 'Maybe', icon: CircleHelp, className: 'text-amber-600 dark:text-amber-400' },
  needsAction: { label: 'No reply', icon: Clock, className: 'text-muted-foreground' },
  declined: { label: 'Not going', icon: X, className: 'text-destructive' },
}

/** Who replied to the invite, newest answer wins. Mirrored from the organizer's Google or Outlook event. */
export function RsvpList({ rsvps }: { rsvps: Rsvp[] }) {
  if (rsvps.length === 0) return null

  const counts = order
    .map((status) => ({ status, count: rsvps.filter((r) => r.status === status).length }))
    .filter((entry) => entry.count > 0)
  const sorted = [...rsvps].sort(
    (a, b) =>
      order.indexOf(a.status) - order.indexOf(b.status) ||
      (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? ''),
  )
  const latest = rsvps.reduce((newest, r) => (r.updated_at > newest ? r.updated_at : newest), rsvps[0].updated_at)

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {counts.map(({ status, count }, i) => (
          <span key={status}>
            {i > 0 && ' · '}
            <span className={look[status].className}>
              {count} {look[status].label.toLowerCase()}
            </span>
          </span>
        ))}
      </p>
      <ul className="space-y-1">
        {sorted.map((rsvp) => {
          const { label, icon: Icon, className } = look[rsvp.status]
          return (
            <li key={rsvp.user_id} className="flex items-center gap-2 text-sm">
              {rsvp.profile && <PersonAvatar profile={rsvp.profile} className="size-5" />}
              <span className="min-w-0 flex-1 truncate">{rsvp.profile?.display_name ?? 'Someone'}</span>
              <span className={cn('flex items-center gap-1 text-xs', className)}>
                <Icon className="size-3.5" />
                {label}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        From the calendar invite, as of {new Date(latest).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.
      </p>
    </div>
  )
}
