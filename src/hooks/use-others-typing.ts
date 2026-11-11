import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth, useUserIdentity } from '@/features/auth/hooks'
import { joinEditing, type EditingRoom, type Typist } from '@/lib/presence'

/** Someone counts as typing until they've been quiet for this long. */
const TYPING_IDLE_MS = 8000

/**
 * For a text that several people can edit: who else is typing in it right now,
 * and `markTyping()` to call on every local edit. Only people who can edit join
 * (`enabled`).
 *
 * `others` is everyone else typing. `lockedBy` is who has the text for now:
 * editors here don't merge two people's edits, so whoever started typing first
 * keeps it and everyone else reads until they've been quiet for a few seconds.
 * It is empty for the person who has it. This is a courtesy between browsers
 * (Realtime Presence), not a database lock: two people who start in the same
 * instant resolve to one, but a tab that has lost its connection isn't held back.
 */
export function useOthersTyping(topic: string, enabled: boolean) {
  const { user } = useAuth()
  const { name } = useUserIdentity()
  const [typists, setTypists] = useState<Typist[]>([])
  const [recentlyEditingBy, setRecentlyEditingBy] = useState<string[]>([])
  /** When this tab started typing, or null while it isn't. */
  const [mine, setMine] = useState<number | null>(null)
  const [tab, setTab] = useState('')
  const room = useRef<EditingRoom | null>(null)
  const idle = useRef<number | undefined>(undefined)
  const latestName = useRef(name)
  useEffect(() => {
    latestName.current = name
  })

  const receiveTypists = useCallback((next: Typist[]) => {
    setTypists(next)
    if (next.length > 0) setRecentlyEditingBy([...new Set(next.map((typist) => typist.name))])
  }, [])

  useEffect(() => {
    if (!enabled) return
    let attempts = 0
    let start: number | undefined
    const join = () => {
      try {
        room.current = joinEditing(topic, { userId: user.id, name: () => latestName.current }, receiveTypists)
      } catch (error) {
        console.error('[presence] Could not join', error)
        return
      }
      if (room.current) setTab(room.current.tab)
      else if (++attempts < 20) start = window.setTimeout(join, 300)
    }
    // Joining a moment later skips StrictMode's throwaway first mount.
    start = window.setTimeout(join, 150)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(idle.current)
      room.current?.leave()
      room.current = null
    }
  }, [topic, enabled, receiveTypists, user.id])

  const markTyping = useCallback(() => {
    const now = Date.now()
    room.current?.setTyping(true, now)
    setMine((current) => current ?? now)
    setRecentlyEditingBy([])
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => {
      room.current?.setTyping(false)
      setMine(null)
    }, TYPING_IDLE_MS)
  }, [])
  const clearRecentlyEditingBy = useCallback(() => setRecentlyEditingBy([]), [])

  const others = useMemo(() => [...new Set(typists.map((typist) => typist.name))], [typists])
  const lockedBy = useMemo(() => {
    // Not typing: anyone who is has it. Typing: only someone who started first (same instant: the lower tab id).
    const ahead = typists.filter((other) => mine === null || other.since < mine || (other.since === mine && other.tab < tab))
    return [...new Set(ahead.map((typist) => typist.name))]
  }, [typists, mine, tab])

  return { others, lockedBy, recentlyEditingBy, markTyping, clearRecentlyEditingBy }
}
