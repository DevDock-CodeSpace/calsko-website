import { queryOptions } from '@tanstack/react-query'
import { toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Prices } from './price'

// The public course catalog (20261102100000_course_catalog): /learn/<group> and /learn/<group>/<course>,
// readable without signing in through public_catalog / public_course, which return only published
// courses' public fields (and a draft to those who can publish it). Lesson text is never in them.

export type PublicPerson = { name: string | null; avatar_url: string | null }
export type PublicGroup = { name: string; slug: string; logo_path: string | null }
export type CatalogCourse = Prices & { id: string; title: string; description: string | null; lessons: number; teachers: PublicPerson[] }
export type PublicCourse = Prices & {
  id: string
  title: string
  description: string | null
  published: boolean
  teachers: PublicPerson[]
  outline: { title: string; lessons: string[] }[]
}

export const catalogKeys = {
  catalog: (slug: string) => ['catalog', slug] as const,
  course: (slug: string, courseId: string) => ['catalog', slug, courseId] as const,
}

/** null when the group has no published course (or doesn't exist). */
export const publicCatalogQuery = (slug: string) =>
  queryOptions({
    queryKey: catalogKeys.catalog(slug),
    queryFn: async (): Promise<{ group: PublicGroup; courses: CatalogCourse[] } | null> => {
      const { data, error } = await supabase.rpc('public_catalog', { p_team_slug: slug })
      if (error) throw toDataError('load the courses', error)
      return (data as { group: PublicGroup; courses: CatalogCourse[] } | null) ?? null
    },
  })

/** null when the course isn't published (and the visitor can't preview it). */
export const publicCourseQuery = (slug: string, courseId: string) =>
  queryOptions({
    queryKey: catalogKeys.course(slug, courseId),
    queryFn: async (): Promise<{ group: PublicGroup; course: PublicCourse; enrolled: boolean } | null> => {
      const { data, error } = await supabase.rpc('public_course', { p_team_slug: slug, p_course_id: courseId })
      if (error) throw toDataError('load the course', error)
      return (data as { group: PublicGroup; course: PublicCourse; enrolled: boolean } | null) ?? null
    },
  })

/** Joins a published free course from its page (the group too). Returns the group's slug. */
export async function enrollPublishedCourse(courseId: string): Promise<string> {
  const { data, error } = await supabase.rpc('enroll_published_course', { p_course_id: courseId })
  if (error) throw toDataError('enroll', error, { '22023': error.message, '42501': error.message })
  return data
}

/** A course code from the course page (group invites work too). Returns the course it enrolled in, if any. */
export async function redeemCode(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('join_with_code', { p_code: code })
  if (error) throw toDataError('use the code', error, { P0001: 'That code is invalid, already used, or withdrawn.' })
  return (data as { workspace_id: string | null }).workspace_id
}

/** The group's logo (public bucket), without loading the groups API. */
export const groupLogoUrl = (path: string) => supabase.storage.from('team-logos').getPublicUrl(path).data.publicUrl
