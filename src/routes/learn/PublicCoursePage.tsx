import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowRight, Clock, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLoaderData, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { enrollPublishedCourse, publicCourseQuery, redeemCode } from '@/features/catalog/api'
import type { publicCourseLoader } from '@/features/catalog/loaders'
import { formatPrice, isFree, visitorCurrency } from '@/features/catalog/price'
import { errorMessage } from '@/lib/errors'
import { PublicShell } from './PublicShell'

/**
 * /learn/:teamSlug/:courseId: one course for anyone: what it teaches, its outline (titles only), its
 * teachers and price. Free: Enroll (signs in first, then joins the group and the course). Paid: the price,
 * "payments open soon", and a course code box until checkout exists.
 */
export function PublicCoursePage() {
  const { teamSlug = '', courseId = '' } = useParams()
  const { userId } = useLoaderData<typeof publicCourseLoader>()
  const { group, course, enrolled } = useSuspenseQuery(publicCourseQuery(teamSlug, courseId)).data!
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [code, setCode] = useState(params.get('code') ?? '')
  const free = isFree(course)
  const here = `/learn/${teamSlug}/${courseId}`
  const signIn = (after: string) => navigate(`/login?next=${encodeURIComponent(after)}`)
  // The course's lessons in the app (learningPath, written out so this page doesn't load the app's nav).
  const open = (slug: string, id: string) => navigate(`/t/${slug}/w/${id}/learning`)

  const enroll = useMutation({
    mutationFn: () => enrollPublishedCourse(courseId),
    onSuccess: async (slug) => {
      await queryClient.invalidateQueries({ queryKey: ['teams'] })
      toast.success(`You’re enrolled in ${course.title}`)
      open(slug, courseId)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const redeem = useMutation({
    mutationFn: () => redeemCode(code),
    onSuccess: async (joined) => {
      await queryClient.invalidateQueries({ queryKey: ['teams'] })
      toast.success('You’re enrolled')
      open(group.slug, joined ?? courseId)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  // Back from signing in to enroll: finish what they started, once.
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current || !userId || enrolled || !free || params.get('enroll') !== '1') return
    resumed.current = true
    enroll.mutate()
  }, [userId, enrolled, free, params, enroll])

  const startFree = () => (userId ? enroll.mutate() : signIn(`${here}?enroll=1`))
  const submitCode = (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    if (userId) redeem.mutate()
    else signIn(`${here}?code=${encodeURIComponent(code.trim())}`)
  }
  const lessons = course.outline.reduce((n, m) => n + m.lessons.length, 0)

  return (
    <PublicShell group={group} signedIn={userId !== null}>
      {!course.published && (
        <p className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Preview: this course is a draft, so only its teachers and the group’s admins can see this page.
        </p>
      )}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">{course.title}</h1>
          {course.teachers.length > 0 && (
            <p className="mt-2 text-muted-foreground">With {course.teachers.map((t) => t.name ?? 'a teacher').join(', ')}</p>
          )}
          {course.description && <p className="mt-6 whitespace-pre-wrap text-[15px] leading-relaxed">{course.description}</p>}

          <h2 className="mt-10 text-lg font-semibold">What’s inside</h2>
          <p className="text-sm text-muted-foreground">
            {course.outline.length} {course.outline.length === 1 ? 'module' : 'modules'} · {lessons} {lessons === 1 ? 'lesson' : 'lessons'}
          </p>
          <ol className="mt-4 divide-y rounded-lg border">
            {course.outline.map((module, i) => (
              <li key={i} className="p-4">
                <p className="font-medium">
                  <span className="mr-2 font-mono text-sm text-muted-foreground">{i + 1}</span>
                  {module.title}
                </p>
                <ul className="mt-2 space-y-1 pl-6 text-sm text-muted-foreground">
                  {module.lessons.map((lesson, j) => (
                    <li key={j}>
                      <span className="mr-2 font-mono text-xs">
                        {i + 1}.{j + 1}
                      </span>
                      {lesson}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <aside className="h-fit space-y-4 rounded-xl border p-5 lg:sticky lg:top-6">
          <p className="text-3xl font-semibold">{formatPrice(course, visitorCurrency())}</p>
          {enrolled ? (
            <Button size="lg" className="w-full" onClick={() => open(group.slug, courseId)}>
              Go to the course <ArrowRight />
            </Button>
          ) : free ? (
            <Button size="lg" className="w-full" disabled={enroll.isPending || !course.published} onClick={startFree}>
              {enroll.isPending && <LoaderCircle className="animate-spin" />}
              {userId ? 'Enroll free' : 'Sign in to enroll free'}
            </Button>
          ) : (
            <Button size="lg" className="w-full" disabled>
              <Clock /> Payments open soon
            </Button>
          )}
          {!enrolled && (
            <form onSubmit={submitCode} className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Have a course code?</p>
              <p className="text-xs text-muted-foreground">From your teacher, or a scholarship.</p>
              <div className="flex gap-2">
                <Input
                  aria-label="Course code"
                  value={code}
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono uppercase"
                  onChange={(e) => setCode(e.target.value)}
                />
                <Button type="submit" variant="outline" disabled={!code.trim() || redeem.isPending}>
                  {redeem.isPending && <LoaderCircle className="animate-spin" />}
                  Use
                </Button>
              </div>
            </form>
          )}
          <p className="text-xs text-muted-foreground">
            Enrolling adds you to {group.name} on Calsko, where the lessons are.
          </p>
        </aside>
      </div>
    </PublicShell>
  )
}
