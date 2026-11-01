import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Check, Copy, LoaderCircle, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { teamMembersQuery } from '@/features/teams/api'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { teamRoleName } from '@/features/teams/permissions'
import { workspaceMembersQuery } from '@/features/workspaces/api'
import { errorMessage } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  courseCodesQuery,
  createCourseCodes,
  platformKeys,
  revokeCourseCode,
  setCourseEnrollment,
  setCourseTeacher,
  type CourseCode,
  type CourseEnrollment,
} from '../platformApi'

/**
 * A course's Members tab, for its teachers and the group's admins: how students get in (open or invite
 * only), who teaches it, and course codes (single use, free: fee waived). Students are the list below it.
 */
export function CourseEnrollmentPanel() {
  const { team } = useCurrentTeam()
  const { workspace } = useCurrentWorkspace()
  const [{ data: groupPeople }, { data: people }, { data: codes }] = useSuspenseQueries({
    queries: [teamMembersQuery(team.id), workspaceMembersQuery(workspace.id), courseCodesQuery(workspace.id)],
  })
  const queryClient = useQueryClient()
  // "Teachers" in learning groups, "Trainers" elsewhere (a company's onboarding course).
  const Trainer = teamRoleName('teacher', team.type)
  const trainer = Trainer.toLowerCase()
  const teachers = people.filter((p) => p.via === 'member' && p.role === 'lead')
  const canTeach = groupPeople.filter(
    (p) => (p.role === 'teacher' || p.role === 'admin' || p.role === 'owner') && !teachers.some((t) => t.user_id === p.user_id),
  )

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceMembersQuery(workspace.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      queryClient.invalidateQueries({ queryKey: ['learning'] }),
    ])

  const enrollment = useMutation({
    mutationFn: (mode: CourseEnrollment) => setCourseEnrollment(workspace.id, mode),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const teacher = useMutation({
    mutationFn: (vars: { userId: string; teach: boolean }) => setCourseTeacher(workspace.id, vars.userId, vars.teach),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="mb-10 space-y-8">
      <section aria-labelledby="course-enrollment">
        <h2 id="course-enrollment" className="text-sm font-semibold">
          How students get in
        </h2>
        <div role="radiogroup" aria-label="Enrollment" className="mt-3 grid max-w-xl gap-2 sm:grid-cols-2">
          {(
            [
              { id: 'open', title: 'Open', text: 'Anyone in the group can enroll from Learning, plus course codes.' },
              { id: 'invite', title: 'Invite only', text: 'Only people you add, or who use a course code.' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={workspace.enrollment === option.id}
              disabled={enrollment.isPending}
              onClick={() => workspace.enrollment !== option.id && enrollment.mutate(option.id)}
              className={cn(
                'rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none',
                workspace.enrollment === option.id && 'border-brand bg-brand/5',
              )}
            >
              <span className="text-sm font-medium">{option.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{option.text}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="course-teachers">
        <div className="flex items-center justify-between gap-4">
          <h2 id="course-teachers" className="text-sm font-semibold">
            {Trainer}s
          </h2>
          {canTeach.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus /> Add a co-{trainer}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canTeach.map((p) => (
                  <DropdownMenuItem key={p.user_id} onSelect={() => teacher.mutate({ userId: p.user_id, teach: true })}>
                    {p.profile?.display_name ?? 'Someone'}
                    <span className="ml-auto pl-4 text-xs text-muted-foreground">{teamRoleName(p.role, team.type)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-2">
          {teachers.map((t) => (
            <li key={t.user_id} className="flex items-center gap-2 rounded-full border py-1 pr-1 pl-1.5 text-sm">
              <PersonAvatar profile={t.profile} userId={t.user_id} className="size-5" />
              {t.profile?.display_name ?? Trainer}
              {teachers.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Stop ${t.profile?.display_name ?? 'them'} leading this course`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => teacher.mutate({ userId: t.user_id, teach: false })}
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className="pr-1" />
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Co-{trainer}s are the group’s {trainer}s and admins. A group admin makes someone a {trainer} on the group’s Members page.
        </p>
      </section>

      <CourseCodes codes={codes} />
    </div>
  )
}

function CourseCodes({ codes }: { codes: CourseCode[] }) {
  const { workspace } = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [count, setCount] = useState('1')
  const [note, setNote] = useState('')
  const [fresh, setFresh] = useState<string[]>([])

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: platformKeys.codes(workspace.id) }),
      queryClient.invalidateQueries({ queryKey: ['learning', 'overview'] }),
    ])

  const make = useMutation({
    mutationFn: () => createCourseCodes(workspace.id, Math.min(Math.max(Number(count) || 1, 1), 50), note),
    onSuccess: async (made) => {
      setFresh(made)
      setNote('')
      await refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: revokeCourseCode,
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    make.mutate()
  }
  const unused = codes.filter((c) => !c.used_at && !c.revoked_at).length

  return (
    <section aria-labelledby="course-codes">
      <h2 id="course-codes" className="text-sm font-semibold">
        Course codes {unused > 0 && <span className="font-mono font-normal text-muted-foreground">· {unused} unused</span>}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Each code works once, for this course only. Whoever uses it joins the group and is enrolled here. Give free codes to students
        whose fee you waive (or anyone, while the course is free). Paid codes will come with checkout.
      </p>

      <form onSubmit={submit} className="mt-3 flex max-w-2xl flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">How many</span>
          <Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} className="w-20 font-mono" />
        </label>
        <label className="min-w-48 flex-1 space-y-1">
          <span className="block text-xs text-muted-foreground">For (optional)</span>
          <Input value={note} maxLength={120} placeholder="Priya · scholarship" onChange={(e) => setNote(e.target.value)} />
        </label>
        <Button type="submit" size="sm" className="h-9" disabled={make.isPending}>
          {make.isPending && <LoaderCircle className="animate-spin" />}
          Make free codes
        </Button>
      </form>

      {fresh.length > 0 && (
        <div className="mt-3 max-w-2xl rounded-md border border-brand/40 bg-brand/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {fresh.length === 1 ? 'Your new code' : `${fresh.length} new codes`}: share {fresh.length === 1 ? 'it' : 'one with each student'}
            </p>
            <CopyButton text={fresh.join('\n')} label="Copy" />
          </div>
          <p className="mt-2 font-mono text-sm leading-relaxed">{fresh.join('  ·  ')}</p>
          <p className="mt-2 text-xs text-muted-foreground">Students enter it at Learning → Use a course code, or when they first sign in.</p>
        </div>
      )}

      {codes.length > 0 && (
        <ul className="mt-4 max-w-3xl divide-y border-y text-sm">
          {codes.map((code) => (
            <li key={code.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className={cn('font-mono', (code.used_at || code.revoked_at) && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
                {code.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{code.note ?? (code.kind === 'free' ? 'Free' : 'Paid')}</span>
              <span className="text-xs text-muted-foreground">
                {code.used_at ? (
                  <span className="inline-flex items-center gap-1.5">
                    <PersonAvatar profile={code.user} userId={code.used_by ?? undefined} className="size-4" />
                    Used by {code.user?.display_name ?? 'someone'} · {formatShortDate(code.used_at)}
                  </span>
                ) : code.revoked_at ? (
                  'Withdrawn'
                ) : (
                  `Unused · made ${formatShortDate(code.created_at)}`
                )}
              </span>
              {!code.used_at && !code.revoked_at && (
                <span className="flex gap-1">
                  <CopyButton text={code.code} label="Copy" />
                  <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(code.id)}>
                    Withdraw
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('Couldn’t copy. Select the code and copy it instead.')
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : label}
    </Button>
  )
}
