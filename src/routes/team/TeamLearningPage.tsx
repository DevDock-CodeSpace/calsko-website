import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, ExternalLink, KeyRound, LoaderCircle, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { formatBothPrices } from '@/features/catalog/price'
import { useCollectionView } from '@/features/collections/hooks'
import { JoinWithCodeDialog } from '@/features/learning/components/JoinWithCodeDialog'
import { NewCourseDialog } from '@/features/learning/components/NewCourseDialog'
import {
  enrollInCourse,
  type BrowseCourse,
  type LearningCourse,
  type PersonChip,
  type TeachingCourse,
} from '@/features/learning/platformApi'
import { learningOverviewQuery } from '@/features/learning/platformQueries'
import { useCurrentTeam } from '@/features/teams/hooks'
import { learningPath, learningProgressPath, lessonPath, workspacePath } from '@/features/teams/nav'
import { teamRoleName } from '@/features/teams/permissions'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The group's Learning page. Who you are decides what shows:
 * - Teaching: the courses you teach (every course for owners and admins), with the class in numbers;
 * - My learning: the courses you're enrolled in, your progress and the next lesson;
 * - Browse courses: open courses you could join.
 * One call (learning_overview) loads all of it. Follows the collection view like other group lists.
 */
export function TeamLearningPage() {
  const { team, can } = useCurrentTeam()
  const { collection } = useCollectionView()
  const overview = useSuspenseQuery(learningOverviewQuery(team.id)).data
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [now] = useState(Date.now)

  // Courses outside any collection belong to every view.
  const inView = (c: { collection_id: string | null }) => !collection || c.collection_id === null || c.collection_id === collection.id
  const teaching = overview.teaching.filter(inView)
  const learning = overview.learning.filter(inView)
  const browse = overview.browse.filter(inView)
  const showTeaching = can.canCreateCourses || teaching.length > 0

  return (
    <>
      <PageHeader
        title="Learning"
        description={
          showTeaching && learning.length === 0
            ? 'Your courses, your students and how they’re doing.'
            : 'Your courses, what to do next, and courses you can join.'
        }
      >
        {overview.teaching.some((c) => c.published) && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/learn/${team.slug}`} target="_blank">
              <ExternalLink /> Public catalog
            </Link>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setJoining(true)}>
          <KeyRound /> Use a course code
        </Button>
        {can.canCreateCourses && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New course
          </Button>
        )}
      </PageHeader>

      <div className="space-y-12">
        {showTeaching && (
          <Section title="Teaching" count={teaching.length}>
            {teaching.length === 0 ? (
              <Empty>
                No courses yet. <button type="button" className="text-brand hover:underline" onClick={() => setCreating(true)}>Create your first course</button>{' '}
                and add lessons, then bring students in with course codes or open it to the group.
              </Empty>
            ) : (
              <ul className="divide-y border-y">
                {teaching.map((course) => (
                  <TeachingRow key={course.id} course={course} now={now} />
                ))}
              </ul>
            )}
          </Section>
        )}

        {(learning.length > 0 || !showTeaching) && (
          <Section title="My learning" count={learning.length}>
            {learning.length === 0 ? (
              <Empty>
                You’re not in a course yet. Join an open course below, or{' '}
                <button type="button" className="text-brand hover:underline" onClick={() => setJoining(true)}>use a course code</button> from your {teamRoleName('teacher', team.type).toLowerCase()}.
              </Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {learning.map((course) => (
                  <LearningCard key={course.id} course={course} now={now} />
                ))}
              </ul>
            )}
          </Section>
        )}

        {browse.length > 0 && (
          <Section title="Browse courses" count={browse.length}>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {browse.map((course) => (
                <BrowseCard key={course.id} course={course} />
              ))}
            </ul>
          </Section>
        )}
      </div>

      {creating && <NewCourseDialog open onOpenChange={setCreating} />}
      {joining && <JoinWithCodeDialog open onOpenChange={setJoining} />}
    </>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-sm font-semibold">
        {title} {count > 0 && <span className="font-mono font-normal text-muted-foreground">· {count}</span>}
      </h2>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">{children}</p>
}

function Teachers({ people }: { people: PersonChip[] }) {
  if (people.length === 0) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex -space-x-1">
        {people.slice(0, 3).map((p) => (
          <PersonAvatar key={p.id} profile={{ display_name: p.name, avatar_url: p.avatar_url }} userId={p.id} className="size-4 ring-1 ring-background" />
        ))}
      </span>
      <span className="truncate">{people.map((p) => p.name ?? 'Teacher').join(', ')}</span>
    </span>
  )
}

function TeachingRow({ course, now }: { course: TeachingCourse; now: number }) {
  const { team } = useCurrentTeam()
  const stat = (n: number, word: string, tone?: 'warn') => (
    <span className={cn(tone === 'warn' && n > 0 && 'text-amber-600 dark:text-amber-400')}>
      <span className="font-mono">{n}</span> {word}
    </span>
  )
  return (
    <li className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:gap-6">
      <div className="min-w-0 flex-1 space-y-1">
        <Link to={learningPath(team.slug, course.id)} className="flex items-center gap-2 font-medium hover:underline">
          <BookOpen className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{course.title}</span>
          <span className="shrink-0 rounded border px-1.5 text-[11px] font-normal text-muted-foreground">
            {course.enrollment === 'open' ? 'Open' : 'Invite only'}
          </span>
          <span
            className={cn(
              'shrink-0 rounded px-1.5 text-[11px] font-normal',
              course.published ? 'bg-brand/10 text-brand' : 'border text-muted-foreground',
            )}
          >
            {course.published ? `Published · ${formatBothPrices(course)}` : 'Draft'}
          </span>
          {!course.mine && <span className="shrink-0 text-[11px] font-normal text-muted-foreground">not yours</span>}
        </Link>
        <Teachers people={course.teachers} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {stat(course.students, course.students === 1 ? 'student' : 'students')}
        <span>
          <span className="font-mono">{course.avg_percent}%</span> average
        </span>
        {stat(course.not_started, 'not started', 'warn')}
        {stat(course.stalled, 'stuck 7+ days', 'warn')}
        {stat(course.lessons, course.lessons === 1 ? 'lesson' : 'lessons')}
        {course.last_activity && <span>active {timeAgo(course.last_activity, now)}</span>}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button asChild size="sm" variant="ghost">
          <Link to={learningProgressPath(team.slug, course.id)}>Class progress</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`${workspacePath(team.slug, course.id)}/members`}>
            <Users /> Students & codes
            {course.unused_codes > 0 && <span className="font-mono text-muted-foreground">({course.unused_codes})</span>}
          </Link>
        </Button>
      </div>
    </li>
  )
}

function LearningCard({ course, now }: { course: LearningCourse; now: number }) {
  const { team } = useCurrentTeam()
  const percent = course.lessons > 0 ? Math.round((Math.min(course.done, course.lessons) / course.lessons) * 100) : 0
  const finished = course.lessons > 0 && course.done >= course.lessons
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="min-w-0 space-y-1">
        <Link to={learningPath(team.slug, course.id)} className="block truncate font-medium hover:underline">
          {course.title}
        </Link>
        <Teachers people={course.teachers} />
      </div>
      <div className="space-y-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">
            {course.done}/{course.lessons}
          </span>{' '}
          lessons{course.last_done && ` · last ${timeAgo(course.last_done, now)}`}
        </p>
      </div>
      <div className="mt-auto">
        {course.next_lesson ? (
          <Button asChild size="sm" className="max-w-full">
            <Link to={lessonPath(team.slug, course.id, course.next_lesson.id)}>
              {course.done === 0 ? 'Start' : 'Continue'}: <span className="truncate">{course.next_lesson.title}</span> <ArrowRight />
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{finished ? 'Finished. Well done!' : 'No lessons yet.'}</p>
        )}
      </div>
    </li>
  )
}

function BrowseCard({ course }: { course: BrowseCourse }) {
  const { team } = useCurrentTeam()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const enroll = useMutation({
    mutationFn: () => enrollInCourse(course.id),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['learning'] }), queryClient.invalidateQueries({ queryKey: ['workspaces'] })])
      toast.success(`You’re in ${course.title}`)
      navigate(learningPath(team.slug, course.id))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium">{course.title}</p>
        <Teachers people={course.teachers} />
      </div>
      {course.description && <p className="line-clamp-3 text-sm text-muted-foreground">{course.description}</p>}
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{course.lessons}</span> {course.lessons === 1 ? 'lesson' : 'lessons'} ·{' '}
        <span className="font-mono">{course.students}</span> {course.students === 1 ? 'student' : 'students'}
      </p>
      <div className="mt-auto">
        <Button size="sm" variant="outline" disabled={enroll.isPending} onClick={() => enroll.mutate()}>
          {enroll.isPending && <LoaderCircle className="animate-spin" />}
          Enroll
        </Button>
      </div>
    </li>
  )
}
