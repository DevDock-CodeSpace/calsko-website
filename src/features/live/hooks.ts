import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/hooks'
import { useCanWriteDocs } from '@/features/docs/hooks'
import { useCurrentTeam } from '@/features/teams/hooks'
import { myWorkspaceRolesQuery, teamCollectionsQuery, teamWorkspacesQuery } from '@/features/workspaces/api'
import { errorMessage } from '@/lib/errors'
import { liveSessionQuery, seriesSessionsQuery, type LiveSession } from './api'
import { flushCalendarQueue, refreshRsvps, runCalendarOps, type CalendarOp } from './calendar'
import { logError } from '@/lib/error-tracking'

/**
 * Who may schedule, edit and cancel sessions in a scope. The live_sessions
 * policies use the same private.can_write_document() as docs. UI only.
 */
export const useCanWriteLive = useCanWriteDocs

/** Workspace Developers may schedule only in their Development Space; other writers follow document access. */
export function useCanScheduleLive() {
  const { user } = useAuth()
  const { team } = useCurrentTeam()
  const canWrite = useCanWriteLive()
  const workspaces = useSuspenseQuery(teamWorkspacesQuery(team.id)).data
  const collections = useSuspenseQuery(teamCollectionsQuery(team.id)).data
  const workspaceRoles = useSuspenseQuery(myWorkspaceRolesQuery(team.id, user.id)).data
  const developmentCollectionIds = new Set(
    collections.filter((collection) => collection.type === 'development').map((collection) => collection.id),
  )
  return (workspaceId: string | null) => {
    if (canWrite(workspaceId)) return true
    if (workspaceId === null) return false
    return workspaces.some(
      (workspace) =>
        workspace.id === workspaceId &&
        workspace.modules.includes('live') &&
        team.type !== 'learning' &&
        workspace.type === 'general' &&
        workspaceRoles[workspace.id] === 'developer' &&
        workspace.collection_id !== null &&
        developmentCollectionIds.has(workspace.collection_id),
    )
  }
}

/** The current time, updated every `intervalMs` (session status changes as time passes). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function useLoadFresh() {
  const queryClient = useQueryClient()
  return (sessionId: string) => queryClient.fetchQuery({ ...liveSessionQuery(sessionId), staleTime: 0 })
}

/** Runs calendar changes now, or after a trip to Google when there's no token. */
export function useCalendarOps() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const load = useLoadFresh()
  return async (ops: CalendarOp[], returnTo: string) => {
    const result = await runCalendarOps(ops, { load, returnTo, email: user.email })
    if (result === 'done') await queryClient.invalidateQueries({ queryKey: ['live'] })
    return result
  }
}

/** On Meetings pages: finish calendar changes queued before a trip to Google. */
export function useCalendarQueue() {
  const queryClient = useQueryClient()
  const load = useLoadFresh()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    flushCalendarQueue(load).then(
      async (count) => {
        if (count === null) return
        await queryClient.invalidateQueries({ queryKey: ['live'] })
        toast.success('Google Calendar updated. Invites were sent.')
      },
      (error: unknown) => toast.error(errorMessage(error)),
    )
    // Once per mount (`started` also guards StrictMode's double run).
  }, [load, queryClient])
}

/** The meetings of a series (soonest first); empty for one-off meetings. Loads after the page paints. */
export function useSeriesSessions(seriesId: string | null) {
  const query = useQuery({ ...seriesSessionsQuery(seriesId ?? ''), enabled: seriesId !== null })
  return query.data ?? []
}

/**
 * Pulls the invite replies from Google once when an organizer opens a meeting
 * they can edit and has a live calendar token. Never for readers, never on a
 * timer: the figures refresh when the organizer next looks at the page.
 */
export function useRefreshRsvps(session: LiveSession, enabled: boolean) {
  const queryClient = useQueryClient()
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || !session.calendar_event_id || done.current === session.id) return
    done.current = session.id
    refreshRsvps(session).then(
      (updated) => {
        if (updated) void queryClient.invalidateQueries({ queryKey: ['live', session.id] })
      },
      (error: unknown) => logError('[live] Could not refresh invite replies', error),
    )
  }, [enabled, session, queryClient])
}
