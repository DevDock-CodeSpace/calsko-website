import { data, type LoaderFunctionArgs } from 'react-router'
import { getCurrentUser } from '@/features/auth/api'
import { queryClient } from '@/lib/query-client'
import { publicCatalogQuery, publicCourseQuery } from './api'

// Public pages: no session needed. A signed-in visitor's id only changes the buttons (enrolled, enroll).

/** /learn/:teamSlug: 404 when the group has no published course. */
export async function catalogLoader({ params }: LoaderFunctionArgs) {
  const [user, catalog] = await Promise.all([getCurrentUser(), queryClient.fetchQuery(publicCatalogQuery(params.teamSlug ?? ''))])
  if (!catalog) throw data('No courses here yet.', { status: 404 })
  return { userId: user?.id ?? null }
}

/** /learn/:teamSlug/:courseId: 404 unless published (or a draft its teachers preview). */
export async function publicCourseLoader({ params }: LoaderFunctionArgs) {
  const [user, course] = await Promise.all([
    getCurrentUser(),
    queryClient.fetchQuery(publicCourseQuery(params.teamSlug ?? '', params.courseId ?? '')),
  ])
  if (!course) throw data('This course isn’t available.', { status: 404 })
  return { userId: user?.id ?? null }
}
