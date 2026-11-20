import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarArrowDown as CalendarDown, CalendarCheck, CalendarPlus, CircleHelp, Clock, LoaderCircle, Pencil, Repeat, Trash2, Video } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUserIdentity } from '@/features/auth/hooks'
import { useCurrentTeam } from '@/features/teams/hooks'
import { livePath, liveSessionPath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { deleteLiveSeriesFrom, deleteLiveSession, fetchJaasToken, type LiveSession, type Rsvp } from '../api'
import { useLiveCall } from '../call/context'
import {
  buildIcs,
  downloadIcs,
  googleCalendarUrl,
  googleDayUrl,
  icsFileName,
  outlookCalendarUrl,
  outlookDayUrl,
  outlookHost,
  seriesFitsLink,
} from '../ics'
import { cancelOps, syncProvider } from '../calendar'
import { eventProvider } from '../calendar-plan'
import { useAuth } from '@/features/auth/hooks'
import { CALENDAR_NAMES } from '@/features/auth/calendar-token'
import { CalendarChoice } from './CalendarChoice'
import { useRefreshRsvps, useSeriesSessions } from '../hooks'
import { useCalendarOps, useCalendarQueue, useCanWriteLive, useNow, usePreferredCalendar } from '../hooks'
import { canJoin, durationMinutes, EARLY_JOIN_MS, formatDay, formatDuration, formatTime, formatTimeRange, sessionStatus } from '../time'
import { RsvpList } from './RsvpList'
import { ScheduleSessionDialog } from './ScheduleSessionDialog'
import { LiveSessionScope } from './LiveSessionScope'

type LiveSessionViewProps = {
  session: LiveSession & { rsvps?: Rsvp[] }
  /** Set when opened inside a workspace's Live tab. */
  workspaceId?: string
}

/** One live session: when, who it's for, the calendar invite, and the embedded call. */
export function LiveSessionView({ session, workspaceId }: LiveSessionViewProps) {
  useCalendarQueue()
  const { team } = useCurrentTeam()
  const identity = useUserIdentity()
  const canWrite = useCanWriteLive()(session.workspace_id)
  const calendarOps = useCalendarOps()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const now = useNow()
  const { call, startCall, endCall, setAnchorEl } = useLiveCall()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelRest, setCancelRest] = useState(false)
  const series = useSeriesSessions(session.series_id)
  const rsvps = session.rsvps ?? []
  const laterInSeries = series.filter((s) => Date.parse(s.starts_at) > Date.parse(session.starts_at)).length
  const wholeSeries = series.length > 1
  const [preferred, setPreferred] = usePreferredCalendar()
  // The calendar already holding the invite, else the organizer's pick.
  const provider = syncProvider(session, preferred)
  const calendarName = CALENDAR_NAMES[provider]
  const { user } = useAuth()
  const eventUrl = `${window.location.origin}${liveSessionPath(team.slug, session.id, session.workspace_id ?? undefined)}`
  const outlookSite = outlookHost(user.identities ?? [])
  // When the invite went out from a calendar, that calendar's button opens it on the meeting's day:
  // everyone invited already has the meeting there, and the add-event form would make a second copy.
  const sentFrom = session.calendar_event_id ? eventProvider(session.calendar_event_id) : null
  const googleHref = sentFrom === 'google' ? googleDayUrl(session) : googleCalendarUrl(session, eventUrl, series)
  const outlookHref =
    sentFrom === 'outlook' ? outlookDayUrl(session, outlookSite) : outlookCalendarUrl(session, eventUrl, outlookSite)
  // A Google link carries a repeat rule; Outlook's cannot, and irregular dates have no rule.
  const addHint = sentFrom
    ? `The invite is already in ${calendarName}; its button opens the meeting's day.`
    : !wholeSeries
      ? 'Opens your calendar with the meeting filled in.'
      : seriesFitsLink(series)
        ? `Google adds all ${series.length} meetings. Outlook adds this one; the .ics file has all ${series.length}.`
        : `These dates don’t follow a pattern, so the links add this meeting only. The .ics file has all ${series.length}.`

  // The invite lives in the organizer's calendar: only their sign-in can send, change or cancel it.
  const isOrganizer = session.created_by === user.id
  useRefreshRsvps(session, isOrganizer)

  const status = sessionStatus(session, now)
  const joinable = canJoin(session, now, canWrite)
  const chatCall = session.conversation_id !== null
  const active = call?.sessionId === session.id
  const listPath = livePath(team.slug, workspaceId)

  const join = useMutation({
    mutationFn: () => fetchJaasToken(session.id),
    onSuccess: (jaas) =>
      startCall({
        sessionId: session.id,
        jaas,
        title: session.title,
        displayName: identity.name,
        email: identity.email ?? '',
        returnTo: liveSessionPath(team.slug, session.id, workspaceId),
      }),
    onError: (error) => toast.error(errorMessage(error)),
  })

  const syncCalendar = useMutation({
    mutationFn: () =>
      calendarOps(
        [
          session.series_id
            ? { kind: 'sync_series', seriesId: session.series_id, url: eventUrl, provider }
            : { kind: 'sync', sessionId: session.id, url: eventUrl, provider },
        ],
        liveSessionPath(team.slug, session.id, workspaceId),
      ),
    onSuccess: (result) => {
      if (result === 'done') toast.success(`${calendarName} updated. Invites were sent.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const cancel = useMutation({
    mutationFn: async () => {
      const seriesId = session.series_id
      const wholeSeries = seriesId !== null && cancelRest
      if (wholeSeries) await deleteLiveSeriesFrom(seriesId, session.starts_at)
      else await deleteLiveSession(session.id)
      // Leave first so this page doesn't render a deleted session.
      await navigate(listPath, { replace: true })
      await queryClient.invalidateQueries({ queryKey: ['live'] })
      // Cancel the events that are gone, or re-sync the series' event so it only lists what remains.
      const ops = isOrganizer ? cancelOps(session, series, wholeSeries, eventUrl) : []
      if (ops.length === 0) return
      try {
        await calendarOps(ops, listPath)
      } catch (error) {
        toast.error(`Meeting cancelled, but the calendar event wasn’t updated. ${errorMessage(error)}`)
      }
    },
    onSuccess: () => toast.success(cancelRest && session.series_id ? 'Meetings cancelled.' : 'Meeting cancelled.'),
    onError: (error) => toast.error(errorMessage(error)),
  })

  /** Writes an .ics for this meeting, or for every meeting of its series. */
  const saveIcs = (scope: 'one' | 'series') => {
    const sessions = scope === 'series' && series.length > 1 ? series : [session]
    try {
      const url = (s: LiveSession) =>
        `${window.location.origin}${liveSessionPath(team.slug, s.id, s.workspace_id ?? undefined)}`
      downloadIcs(icsFileName(session.title), buildIcs({ sessions, url }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (active) {
    // Fills the area under the top bar: a slim title bar, then the call edge to edge.
    return (
      <div className="flex h-[calc(100svh-3rem)] flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
            <h1 className="truncate text-sm font-semibold">{session.title}</h1>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{formatTimeRange(session)}</span>
          </div>
          <Button variant="outline" size="sm" onClick={endCall}>
            Leave call
          </Button>
        </div>
        {/* CallDock renders the call over this box, so it survives navigation. */}
        <div ref={setAnchorEl} className="min-h-0 flex-1 bg-muted" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Video className="size-3.5" />
        <span>{chatCall ? 'Chat call' : 'Meeting'}</span>
        <span aria-hidden>·</span>
        <LiveSessionScope session={session} />
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{session.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="text-foreground">{formatDay(session.starts_at)}</span>
            <span className="font-mono">{formatTimeRange(session)}</span>
            <span aria-hidden>·</span>
            <span>{formatDuration(durationMinutes(session))}</span>
            {session.series_id && series.length > 1 && (
              <span className="flex items-center gap-1 text-xs">
                <Repeat className="size-3" /> {series.findIndex((s) => s.id === session.id) + 1} of {series.length}
              </span>
            )}
            <StatusBadge status={status} startsAt={session.starts_at} now={now} />
          </p>
        </div>
        {canWrite && !chatCall && (
          <div className="flex shrink-0 items-center gap-1">
            <ScheduleSessionDialog session={session} workspaceId={workspaceId}>
              <Button variant="ghost" size="icon-sm" aria-label="Edit meeting" className="text-muted-foreground">
                <Pencil />
              </Button>
            </ScheduleSessionDialog>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel meeting"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmCancel(true)}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-4">
        <Button onClick={() => join.mutate()} disabled={!joinable || join.isPending}>
          {join.isPending ? <LoaderCircle className="animate-spin" /> : <Video />}
          {status === 'live' ? 'Join now' : 'Join call'}
        </Button>
        <span className="text-sm text-muted-foreground">
          {joinable
            ? status === 'upcoming' && canWrite && Date.parse(session.starts_at) - now > EARLY_JOIN_MS
              ? 'You can open the room early to set up.'
              : 'Opens in Calsko. Your camera and mic are off until you turn them on.'
            : status === 'upcoming'
              ? `Opens 15 minutes before it starts (${formatTime(new Date(Date.parse(session.starts_at) - EARLY_JOIN_MS).toISOString())}).`
              : 'This meeting has ended.'}
        </span>
      </div>

      <dl className="divide-y text-sm">
        <Detail label="For">
          <LiveSessionScope session={session} />
        </Detail>
        <Detail label="Organizer">
          {session.author ? (
            <span className="flex items-center gap-2">
              <PersonAvatar profile={session.author} className="size-5" />
              {session.author.display_name ?? 'Unknown'}
            </span>
          ) : (
            <span className="text-muted-foreground">Unknown</span>
          )}
        </Detail>
        {!chatCall && <Detail label="My calendar">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Plain links: they open the calendar with the meeting filled in, no account connection. */}
              <Button asChild variant="outline" size="xs">
                <a href={googleHref} target="_blank" rel="noreferrer">
                  <CalendarDown /> Google
                </a>
              </Button>
              <Button asChild variant="outline" size="xs">
                <a href={outlookHref} target="_blank" rel="noreferrer">
                  <CalendarDown /> Outlook
                </a>
              </Button>
              <span className="text-xs text-muted-foreground">
                or{' '}
                <button
                  type="button"
                  onClick={() => saveIcs(wholeSeries ? 'series' : 'one')}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  download .ics
                </button>
                {wholeSeries && ' (all ' + series.length + ')'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{addHint}</p>
          </div>
        </Detail>}
        {!chatCall && <Detail label="Invites">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {session.calendar_event_id ? (
                <span className="flex items-center gap-1.5">
                  <CalendarCheck className="size-4 text-muted-foreground" /> Invites sent from {calendarName}
                </span>
              ) : (
                <span className="text-muted-foreground">Nobody invited yet</span>
              )}
              {canWrite && isOrganizer && status !== 'ended' && (
                <span className="flex items-center gap-1">
                  {!session.calendar_event_id && (
                    <CalendarChoice value={provider} onChange={setPreferred} disabled={syncCalendar.isPending} />
                  )}
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => syncCalendar.mutate()}
                    disabled={syncCalendar.isPending}
                  >
                    {syncCalendar.isPending ? <LoaderCircle className="animate-spin" /> : <CalendarPlus />}
                    {session.calendar_event_id ? 'Update invites' : 'Invite everyone'}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="What this does"
                        className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <CircleHelp className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {session.calendar_event_id
                        ? `Updates the event in your ${calendarName} and emails everyone this meeting is for again, so they see the change.`
                        : `Creates the event in your ${calendarName} and emails an invite to everyone this meeting is for. They don’t need a Calsko, Google or Microsoft account to receive it.`}
                    </TooltipContent>
                  </Tooltip>
                </span>
              )}
            </div>
            {!canWrite && rsvps.length === 0 && (
              <p className="text-xs text-muted-foreground">Leads and group admins send invites.</p>
            )}
            {canWrite && !isOrganizer && status !== 'ended' && (
              <p className="text-xs text-muted-foreground">
                Only the organizer can send or update invites, from their own calendar.
              </p>
            )}
            <RsvpList rsvps={rsvps} />
          </div>
        </Detail>}
        {session.description && (
          <Detail label="Notes">
            <p className="whitespace-pre-wrap">{session.description}</p>
          </Detail>
        )}
      </dl>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel ${session.title}?`}
        description={
          session.calendar_event_id && !isOrganizer
            ? `The meeting is deleted here. Its ${calendarName} invite stays in people’s calendars: only the organizer can cancel it.`
            : session.series_id
              ? 'This meeting is deleted. It can’t be undone.'
              : session.calendar_event_id
                ? `The meeting is deleted and the ${calendarName} event is cancelled for everyone invited.`
                : 'The meeting is deleted. This can’t be undone.'
        }
        confirmLabel={cancelRest && laterInSeries > 0 ? `Cancel ${laterInSeries + 1} meetings` : 'Cancel meeting'}
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      >
        {session.series_id && laterInSeries > 0 && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={cancelRest}
              onChange={(e) => setCancelRest(e.target.checked)}
              className="mt-0.5 size-4 accent-brand"
            />
            <span>
              Also cancel the {laterInSeries} later {laterInSeries === 1 ? 'meeting' : 'meetings'} in this series
            </span>
          </label>
        )}
      </ConfirmDialog>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function StatusBadge({ status, startsAt, now }: { status: ReturnType<typeof sessionStatus>; startsAt: string; now: number }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        status === 'live' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
      )}
    >
      {status === 'live' ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : <Clock className="size-3" />}
      {status === 'live' ? 'Live now' : status === 'ended' ? 'Ended' : `Starts ${timeAgo(startsAt, now)}`}
    </span>
  )
}
