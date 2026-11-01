import { queryOptions } from '@tanstack/react-query'
import { toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// The learning platform (20261101161000_learning_platform): teachers create and teach their own courses,
// students enroll course by course (open courses from Browse, invite-only ones with a course code), and the
// group-level Learning page shows Teaching / My learning / Browse from one call (learning_overview).

export type PersonChip = { id: string; name: string | null; avatar_url: string | null }

export type TeachingCourse = {
  id: string
  title: string
  enrollment: CourseEnrollment
  collection_id: string | null
  lessons: number
  teachers: PersonChip[]
  students: number
  avg_percent: number
  not_started: number
  /** Started, not finished, nothing marked done in 7 days. */
  stalled: number
  finished: number
  last_activity: string | null
  unused_codes: number
  /** False for courses an admin sees but doesn't teach. */
  mine: boolean
}

export type LearningCourse = {
  id: string
  title: string
  collection_id: string | null
  lessons: number
  done: number
  last_done: string | null
  next_lesson: { id: string; title: string } | null
  teachers: PersonChip[]
}

export type BrowseCourse = {
  id: string
  title: string
  description: string | null
  collection_id: string | null
  lessons: number
  teachers: PersonChip[]
  students: number
}

export type LearningOverview = { teaching: TeachingCourse[]; learning: LearningCourse[]; browse: BrowseCourse[] }

export type CourseEnrollment = 'open' | 'invite'

export type CourseCode = {
  id: string
  code: string
  kind: 'free' | 'paid'
  note: string | null
  created_at: string
  used_at: string | null
  used_by: string | null
  revoked_at: string | null
  user: { display_name: string | null; avatar_url: string | null } | null
}

export const platformKeys = {
  overview: (teamId: string) => ['learning', 'overview', teamId] as const,
  codes: (workspaceId: string) => ['learning', 'codes', workspaceId] as const,
}

export const courseCodesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: platformKeys.codes(workspaceId),
    queryFn: async (): Promise<CourseCode[]> => {
      const { data, error } = await supabase
        .from('course_codes')
        .select('id, code, kind, note, created_at, used_at, used_by, revoked_at, user:profiles!course_codes_used_by_fkey(display_name, avatar_url)')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw toDataError('load course codes', error)
      return data as CourseCode[]
    },
  })

const passMessage = (error: { message: string }) => ({ '22023': error.message, '42501': error.message })

export async function createCourse(input: {
  teamId: string
  title: string
  description?: string
  enrollment: CourseEnrollment
  collectionId?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_course', {
    p_team_id: input.teamId,
    p_title: input.title.trim(),
    p_description: input.description?.trim() || undefined,
    p_enrollment: input.enrollment,
    p_collection_id: input.collectionId ?? undefined,
  })
  if (error) throw toDataError('create the course', error, passMessage(error))
  return data
}

export async function setCourseEnrollment(workspaceId: string, enrollment: CourseEnrollment) {
  const { error } = await supabase.rpc('set_course_enrollment', { p_workspace_id: workspaceId, p_enrollment: enrollment })
  if (error) throw toDataError('change enrollment', error)
}

export async function enrollInCourse(workspaceId: string) {
  const { error } = await supabase.rpc('enroll_in_course', { p_workspace_id: workspaceId })
  if (error) throw toDataError('enroll', error, passMessage(error))
}

export async function setCourseTeacher(workspaceId: string, userId: string, teacher: boolean) {
  const { error } = await supabase.rpc('set_course_teacher', { p_workspace_id: workspaceId, p_user_id: userId, p_teacher: teacher })
  if (error) throw toDataError('change the course’s teachers', error, passMessage(error))
}

export async function createCourseCodes(workspaceId: string, count: number, note: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('create_course_codes', {
    p_workspace_id: workspaceId,
    p_count: count,
    p_note: note.trim() || undefined,
  })
  if (error) throw toDataError('make course codes', error, passMessage(error))
  return (data ?? []).map((row) => row.code)
}

export async function revokeCourseCode(codeId: string) {
  const { error } = await supabase.rpc('revoke_course_code', { p_code_id: codeId })
  if (error) throw toDataError('withdraw the code', error, passMessage(error))
}
