import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/features/auth/hooks'
import { useLiveCall } from '@/features/live/call/context'
import { readLastActivity } from '@/lib/inactivity'
import { joinGroupStatus } from '@/lib/presence'
import { AWAY_AFTER_MS, tabStatus } from './status'
import { clearStatuses, setStatusTabs, useChosenStatus } from './store'

const CHECK_IDLE_MS = 15_000

/**
 * Joins the group's status channel for as long as the team shell is open (AppLayout, inside
 * LiveCallProvider) and keeps this tab's entry current. It sends only when the status changes.
 * The channel stays joined while the tab is hidden (live data pauses, this doesn't), so someone
 * in another app shows as Away rather than Offline until the inactivity sign-out.
 */
export function useStatusSync(teamId: string) {
  const { user } = useAuth()
  const userId = user?.id
  const { call } = useLiveCall()
  const chosen = useChosenStatus()
  const idle = useIdle()
  const room = useRef<ReturnType<typeof joinGroupStatus> | null>(null)

  useEffect(() => {
    const joined = joinGroupStatus(teamId, setStatusTabs)
    room.current = joined
    return () => {
      joined.leave()
      clearStatuses()
      room.current = null
    }
  }, [teamId])

  useEffect(() => {
    if (room.current && userId) room.current.set({ userId, status: tabStatus(chosen, call !== null, idle) })
  }, [teamId, userId, chosen, call, idle])
}

/** True after AWAY_AFTER_MS without input in any Calsko tab (the inactivity clock, shared by tabs). */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    const check = () => {
      const last = readLastActivity()
      setIdle(last !== null && Date.now() - last >= AWAY_AFTER_MS)
    }
    check()
    const timer = window.setInterval(check, CHECK_IDLE_MS)
    // Coming back shows Available at once (the clock is written within 5 s of input).
    const soon = () => window.setTimeout(check, 6000)
    window.addEventListener('pointerdown', soon)
    window.addEventListener('keydown', soon)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', soon)
      window.removeEventListener('keydown', soon)
      window.removeEventListener('focus', check)
    }
  }, [])
  return idle
}
