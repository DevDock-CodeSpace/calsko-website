import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Globe, LoaderCircle, Repeat } from 'lucide-react'
import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentTeam } from '@/features/teams/hooks'
import { liveSessionPath } from '@/features/teams/nav'
import { workspaceTypes } from '@/features/teams/permissions'
import { useCollectionView } from '@/features/collections/hooks'
import { errorMessage } from '@/lib/errors'
import { createLiveSeries, createLiveSession, updateLiveSession, type LiveSession } from '../api'
import { useCalendarOps, useCanScheduleLive, useCanWriteLive } from '../hooks'
import {
  describeSeries,
  generateStarts,
  MAX_OCCURRENCES,
  noRepeat,
  parseDateKey,
  repeatKinds,
  repeatProblem,
  WEEKDAY_NAMES,
  type RepeatKind,
  type RepeatRule,
} from '../recurrence'
import {
  durationMinutes,
  formatDuration,
  formatDay,
  formatTime,
  fromLocalInputs,
  nextFullHour,
  toLocalInputs,
} from '../time'
import { DatesPicker } from './DatesPicker'

// The date and time fields load with the open dialog; this file is in the first load (Meetings pages).
const DateField = lazy(() => import('./DateField').then((m) => ({ default: m.DateField })))
const TimeSelect = lazy(() => import('./TimeSelect').then((m) => ({ default: m.TimeSelect })))

const GROUP_WIDE = 'group'

/** Holds a field's place while its code loads (the first time the dialog opens). */
const FieldPlaceholder = () => <div className="h-9 rounded-md border" />
const DURATIONS = [30, 45, 60, 90, 120, 180]

type ScheduleSessionDialogProps = {
  /** Fixes the scope to this workspace (inside a workspace's Meetings tab). */
  workspaceId?: string
  /** Edit this session instead of scheduling a new one. */
  session?: LiveSession
  /** Custom trigger (defaults to a "New meeting" button). */
  children?: ReactNode
  /** Controlled mode, used when the calendar opens the dialog on a clicked day or time slot. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** First meeting's start (defaults to the next full hour). */
  defaultStart?: Date
}

/**
 * Schedule (or edit) a meeting: title, audience, date, time, length, how often
 * it repeats (new meetings only), notes, and whether to put it in the
 * organizer's Google Calendar with everyone in the audience invited. Only
 * offered in scopes where the user may schedule.
 */
export function ScheduleSessionDialog({
  workspaceId,
  session,
  children,
  open: controlledOpen,
  onOpenChange,
  defaultStart,
}: ScheduleSessionDialogProps) {
  const { team } = useCurrentTeam()
  // Only the collection being looked at (everything, in a group without collections).
  const { workspaces } = useCollectionView()
  const canWrite = useCanWriteLive()
  const canSchedule = useCanScheduleLive()
  const calendarOps = useCalendarOps()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const editing = session !== undefined

  const scopes = editing
    ? []
    : workspaceId
      ? canSchedule(workspaceId)
        ? [workspaceId]
        : []
      : [
          ...(canSchedule(null) ? [GROUP_WIDE] : []),
          ...workspaces.filter((w) => canSchedule(w.id) && (canWrite(w.id) || w.type === 'project')).map((w) => w.id),
        ]

  const initial = () => {
    const start = session ? new Date(session.starts_at) : (defaultStart ?? nextFullHour(Date.now()))
    const { date, time } = toLocalInputs(start)
    return {
      title: session?.title ?? '',
      description: session?.description ?? '',
      date,
      time,
      duration: session ? durationMinutes(session) : 60,
      scope: scopes[0] ?? GROUP_WIDE,
      // New sessions go to the calendar by default; edits update an existing invite.
      calendar: session ? session.calendar_event_id !== null : true,
    }
  }
  const [innerOpen, setInnerOpen] = useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (next: boolean) => {
    setInnerOpen(next)
    onOpenChange?.(next)
  }
  const [form, setForm] = useState(initial)
  const [rule, setRule] = useState<RepeatRule>(noRepeat)
  const setKind = (kind: RepeatKind) =>
    setRule((r) => ({
      ...r,
      kind,
      days: kind === 'weekly' && r.days.length === 0 ? [(parseDateKey(form.date) ?? new Date()).getDay()] : r.days,
    }))
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const firstDate = fromLocalInputs(form.date, form.time)
  const starts = useMemo(() => generateStarts(form.date, form.time, rule), [form.date, form.time, rule])
  const start = starts[0] ?? null
  const problem = editing ? null : repeatProblem(rule, starts)
  const series = starts.length > 1
  const durations = DURATIONS.includes(form.duration) ? DURATIONS : [...DURATIONS, form.duration].sort((a, b) => a - b)

  const save = useMutation({
    mutationFn: async () => {
      const first = session ? firstDate : start
      if (!first) throw new Error('Pick a valid date and time.')
      const input = {
        title: form.title,
        description: form.description,
        startsAt: first.toISOString(),
        endsAt: new Date(first.getTime() + form.duration * 60_000).toISOString(),
      }
      let id: string
      let seriesId: string | null
      let sessionWorkspace: string | null
      if (session) {
        await updateLiveSession(session.id, input)
        id = session.id
        seriesId = session.series_id
        sessionWorkspace = session.workspace_id
      } else {
        sessionWorkspace = form.scope === GROUP_WIDE ? null : form.scope
        if (series) {
          const created = await createLiveSeries({
            ...input,
            teamId: team.id,
            workspaceId: sessionWorkspace,
            starts,
            durationMinutes: form.duration,
          })
          id = created[0].id
          seriesId = created[0].seriesId
        } else {
          id = (
            await createLiveSession({
              ...input,
              teamId: team.id,
              workspaceId: sessionWorkspace,
            })
          ).id
          seriesId = null
        }
      }
      // Where the calendar event links to (members of the audience can open it there).
      const url = `${window.location.origin}${liveSessionPath(team.slug, id, sessionWorkspace ?? undefined)}`
      // Where the organizer lands (the view they scheduled from).
      const returnTo = liveSessionPath(team.slug, id, workspaceId)
      await queryClient.invalidateQueries({ queryKey: ['live'] })
      if (!form.calendar) return { id, returnTo, calendar: 'skipped' as const }
      try {
        const op = seriesId
          ? ({ kind: 'sync_series', seriesId, url } as const)
          : ({ kind: 'sync', sessionId: id, url } as const)
        const result = await calendarOps([op], returnTo)
        return { id, returnTo, calendar: result }
      } catch (error) {
        // The session is saved either way; say what didn't happen.
        toast.error(errorMessage(error))
        return { id, returnTo, calendar: 'failed' as const }
      }
    },
    onSuccess: ({ returnTo, calendar }) => {
      // Leaving for Google: the queued sync finishes when they come back.
      if (calendar === 'redirecting') return
      setOpen(false)
      const what = series ? `${starts.length} meetings` : 'Meeting'
      if (calendar === 'done')
        toast.success(editing ? 'Meeting and calendar invite updated.' : `${what} scheduled. Calendar invites sent.`)
      else if (calendar === 'skipped') toast.success(editing ? 'Meeting updated.' : `${what} scheduled.`)
      if (!editing) navigate(returnTo)
    },
  })

  if (!editing && scopes.length === 0) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (form.title.trim() && (editing ? firstDate : start) && !problem) save.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return
        setOpen(next)
        if (next) {
          setForm(initial())
          setRule(noRepeat())
        } else save.reset()
      }}
    >
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          {children ?? (
            <Button size="sm">
              <CalendarPlus /> New meeting
            </Button>
          )}
        </DialogTrigger>
      )}
      {/* The repeat options make this form taller than a laptop screen, so the fields scroll
          while the title and the Schedule button stay put. */}
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit meeting' : 'Schedule a meeting'}</DialogTitle>
            <DialogDescription>
              {editing
                ? session.series_id
                  ? 'This changes only this meeting of the series.'
                  : 'Changes are sent to everyone invited when the calendar invite is updated.'
                : 'A video call in Calsko. Everyone it’s for can see it here and join from the meeting page.'}
            </DialogDescription>
          </DialogHeader>

          <div className="-mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
            <div className="space-y-1.5">
              <Label htmlFor="live-title">Title</Label>
              <Input
                id="live-title"
                value={form.title}
                maxLength={200}
                placeholder="Week 3: REST APIs live coding"
                onChange={(e) => set('title', e.target.value)}
                required
                autoFocus
              />
            </div>

            {!editing && !workspaceId && (
              <div className="space-y-1.5">
                <Label htmlFor="live-scope">For</Label>
                <Select value={form.scope} onValueChange={(value) => set('scope', value)}>
                  <SelectTrigger id="live-scope" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scopes.map((id) => {
                      if (id === GROUP_WIDE) {
                        return (
                          <SelectItem key={id} value={id}>
                            <Globe className="text-muted-foreground" />
                            Whole group
                          </SelectItem>
                        )
                      }
                      const workspace = workspaces.find((w) => w.id === id)
                      if (!workspace) return null
                      const Icon = workspaceTypes[workspace.type].icon
                      return (
                        <SelectItem key={id} value={id}>
                          <Icon className="text-muted-foreground" />
                          {workspace.title}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.7fr)] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="live-date">{rule.kind === 'dates' ? 'First date' : 'Date'}</Label>
                <Suspense fallback={<FieldPlaceholder />}>
                  <DateField
                    id="live-date"
                    value={form.date}
                    disabled={rule.kind === 'dates'}
                    onChange={(value) => set('date', value)}
                  />
                </Suspense>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="live-time">Start</Label>
                <Suspense fallback={<FieldPlaceholder />}>
                  <TimeSelect id="live-time" value={form.time} onChange={(value) => set('time', value)} />
                </Suspense>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="live-duration">Length</Label>
                <Select value={String(form.duration)} onValueChange={(value) => set('duration', Number(value))}>
                  <SelectTrigger id="live-duration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {durations.map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {formatDuration(minutes)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!editing && (
              <RepeatSection
                rule={rule}
                setRule={setRule}
                setKind={setKind}
                date={form.date}
                starts={starts}
                problem={problem}
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="live-description">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="live-description"
                value={form.description}
                maxLength={5000}
                rows={3}
                placeholder="What to prepare, links, agenda…"
                onChange={(e) => set('description', e.target.value)}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={form.calendar}
                onChange={(e) => set('calendar', e.target.checked)}
                className="mt-0.5 size-4 accent-brand"
              />
              <span className="space-y-0.5">
                <span className="block font-medium">
                  {editing && session.calendar_event_id
                    ? 'Update the Google Calendar invite'
                    : series
                      ? 'Add the series to Google Calendar'
                      : 'Add to Google Calendar'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Creates the event in your calendar and emails an invite to everyone{' '}
                  {editing
                    ? 'the session is for'
                    : workspaceId || form.scope !== GROUP_WIDE
                      ? 'in the workspace'
                      : 'in the group'}
                  . Google may ask you to allow calendar access.
                </span>
              </span>
            </label>

            {save.isError && (
              <p role="alert" className="text-sm text-destructive">
                {save.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!form.title.trim() || !(editing ? firstDate : start) || !!problem || save.isPending}
            >
              {save.isPending && <LoaderCircle className="animate-spin" />}
              {editing ? 'Save changes' : series ? `Schedule ${starts.length} meetings` : 'Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type RepeatSectionProps = {
  rule: RepeatRule
  setRule: (update: (rule: RepeatRule) => RepeatRule) => void
  setKind: (kind: RepeatKind) => void
  date: string
  starts: Date[]
  problem: string | null
}

/** "Repeat" options: how often, on which days or dates, and when it stops, with a preview of what will be created. */
function RepeatSection({ rule, setRule, setKind, date, starts, problem }: RepeatSectionProps) {
  const repeating = rule.kind !== 'none'
  const toggleDay = (day: number) =>
    setRule((r) => ({
      ...r,
      days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day],
    }))
  // Monday first, like the calendar.
  const dayOrder = [1, 2, 3, 4, 5, 6, 0]

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="live-repeat" className="flex items-center gap-1.5">
          <Repeat className="size-3.5 text-muted-foreground" /> Repeat
        </Label>
        <Select value={rule.kind} onValueChange={(value) => setKind(value as RepeatKind)}>
          <SelectTrigger id="live-repeat" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {repeatKinds.map((kind) => (
              <SelectItem key={kind.value} value={kind.value}>
                {kind.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rule.kind === 'weekly' && (
        <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1.5">
          {dayOrder.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={rule.days.includes(day)}
              onClick={() => toggleDay(day)}
              className={
                rule.days.includes(day)
                  ? 'rounded-md border border-brand bg-brand px-2.5 py-1 text-xs font-medium text-white'
                  : 'rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted'
              }
            >
              {WEEKDAY_NAMES[day]}
            </button>
          ))}
        </div>
      )}

      {rule.kind === 'dates' && (
        <DatesPicker
          value={rule.dates}
          onChange={(dates) => setRule((r) => ({ ...r, dates }))}
          initialMonth={parseDateKey(date) ?? new Date()}
        />
      )}

      {repeating && rule.kind !== 'dates' && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="live-ends">Ends</Label>
            <Select
              value={rule.end.mode}
              onValueChange={(mode) =>
                setRule((r) => ({
                  ...r,
                  end: mode === 'count' ? { mode: 'count', count: 10 } : { mode: 'until', until: lastDayDefault(date) },
                }))
              }
            >
              <SelectTrigger id="live-ends" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">After a number of meetings</SelectItem>
                <SelectItem value="until">On a date</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            {rule.end.mode === 'count' ? (
              <>
                <Label htmlFor="live-count">Meetings (up to {MAX_OCCURRENCES})</Label>
                <Input
                  id="live-count"
                  type="number"
                  min={1}
                  max={MAX_OCCURRENCES}
                  value={rule.end.count}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      end: {
                        mode: 'count',
                        count: Math.min(MAX_OCCURRENCES, Math.max(1, Number(e.target.value) || 1)),
                      },
                    }))
                  }
                />
              </>
            ) : (
              <>
                <Label htmlFor="live-until">Last day</Label>
                <Suspense fallback={<FieldPlaceholder />}>
                  <DateField
                    id="live-until"
                    min={date}
                    value={rule.end.until}
                    onChange={(until) =>
                      setRule((r) => ({
                        ...r,
                        end: { mode: 'until', until },
                      }))
                    }
                  />
                </Suspense>
              </>
            )}
          </div>
        </div>
      )}

      {repeating &&
        (problem ? (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        ) : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{describeSeries(rule, starts)}</p>
            <ul className="max-h-24 space-y-0.5 overflow-y-auto font-mono">
              {starts.map((d) => (
                <li key={d.getTime()}>
                  {formatDay(d.toISOString())}, {formatTime(d.toISOString())}
                </li>
              ))}
            </ul>
            <p>Each one is its own meeting you can edit or cancel separately.</p>
          </div>
        ))}
    </div>
  )
}

/** Default "last day" for an end-on-date repeat: four weeks after the first meeting. */
function lastDayDefault(date: string): string {
  const first = parseDateKey(date) ?? new Date()
  const end = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 28)
  return toLocalInputs(end).date
}
