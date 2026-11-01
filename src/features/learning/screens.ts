import { preloadable } from '@/lib/preloadable'

/** The lesson editor: loaded with the lesson by lessonLoader. */
export const lessonView = preloadable(() => import('./components/LessonView'))

/** A course's Students & codes panel (its Members tab, teachers only): kept out of the first load. */
export const courseEnrollmentPanel = preloadable(async () => ({
  default: (await import('./components/CourseEnrollmentPanel')).CourseEnrollmentPanel,
}))

/** The course Overview's Learning box: only courses need it, so it isn't in the first load. */
export const courseOverviewLearning = preloadable(async () => ({
  default: (await import('./components/CourseOverviewLearning')).CourseOverviewLearning,
}))
