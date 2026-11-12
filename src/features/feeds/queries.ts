import { queryOptions } from '@tanstack/react-query'
import { toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Chat feeds (docs/CHAT_FEEDS.md): bots that post into a group's channels. What Group settings' loader
// needs; the mutations are in api.ts.

export type ChatFeedKind = 'events' | 'errors' | 'webhook'

export const CHAT_EVENTS = [
  { key: 'issue_created', label: 'Issue created' },
  { key: 'issue_closed', label: 'Issue completed or canceled' },
  { key: 'meeting_scheduled', label: 'Meeting scheduled' },
  { key: 'meeting_cancelled', label: 'Meeting cancelled' },
  { key: 'plan_created', label: 'Plan created' },
  { key: 'member_joined', label: 'Someone joined the group' },
] as const
export type ChatEvent = (typeof CHAT_EVENTS)[number]['key']

export type ChatFeed = {
  id: string
  team_id: string
  conversation_id: string
  kind: ChatFeedKind
  name: string
  enabled: boolean
  events: ChatEvent[]
  /** Projects only some people can see that post anyway (projects open to the whole group always do). */
  projects: string[]
  /** Per event, a target other than `conversation_id`. */
  event_targets: Partial<Record<ChatEvent, string>>
  created_at: string
  last_posted_at: string | null
}

export const feedKeys = {
  // Under 'messaging' so it sits with the channels it posts into; Realtime invalidates ['messaging', 'feeds'].
  team: (teamId: string) => ['messaging', 'feeds', teamId] as const,
}

/** The group's feeds (owners and admins; anyone else gets none from RLS). */
export const chatFeedsQuery = (teamId: string) =>
  queryOptions({
    queryKey: feedKeys.team(teamId),
    queryFn: async (): Promise<ChatFeed[]> => {
      const { data, error } = await supabase
        .from('chat_feeds')
        .select('id, team_id, conversation_id, kind, name, enabled, events, projects, event_targets, created_at, last_posted_at')
        .eq('team_id', teamId)
        .order('created_at')
      if (error) throw toDataError('load chat feeds', error)
      return data as ChatFeed[]
    },
  })
