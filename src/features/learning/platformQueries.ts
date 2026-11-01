import { queryOptions } from '@tanstack/react-query'
import { toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { LearningOverview } from './platformApi'

// The Learning page's one query, apart from platformApi's writes: the route loader (in the first load)
// starts it, and the rest loads with the page.

export const overviewKey = (teamId: string) => ['learning', 'overview', teamId] as const

export const learningOverviewQuery = (teamId: string) =>
  queryOptions({
    queryKey: overviewKey(teamId),
    queryFn: async (): Promise<LearningOverview> => {
      const { data, error } = await supabase.rpc('learning_overview', { p_team_id: teamId })
      if (error) throw toDataError('load Learning', error)
      return data as unknown as LearningOverview
    },
  })

