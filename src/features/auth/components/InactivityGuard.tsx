import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useInactivityLogout } from '@/hooks/use-inactivity-logout'
import { sessionExpired } from '@/lib/auth-storage'
import { EXPIRED_REASON, INACTIVE_REASON, INACTIVITY_CHECK_MS, INACTIVITY_LIMIT_MS, WARNING_MS } from '@/lib/inactivity-config'
import { queryClient } from '@/lib/query-client'
import { signOutForInactivity, signOutForSessionLimit } from '../api'
import { safeNextPath } from '../redirect'

/**
 * Signs out a person who has been away for INACTIVITY_LIMIT_MS, asking first,
 * and a session that has reached its time limit (lib/auth-storage), without asking.
 * Rendered once on the `app` route, so only where there is a session.
 */
export function InactivityGuard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [deadline, setDeadline] = useState<number | null>(null)
  const here = location.pathname + location.search

  const onLogout = useCallback(async () => {
    await signOutForInactivity()
    setDeadline(null)
    const search = new URLSearchParams({ reason: INACTIVE_REASON })
    const next = safeNextPath(here)
    if (next !== '/app') search.set('next', next)
    // Leave the page, then drop what was fetched as this user: cleared while the page is up, its
    // queries refetch without a session and fail.
    await navigate(`/login?${search}`, { replace: true })
    queryClient.clear()
  }, [navigate, here])

  const { staySignedIn } = useInactivityLogout({ limitMs: INACTIVITY_LIMIT_MS, warningMs: WARNING_MS, onWarn: setDeadline, onLogout })

  // The session's own time limit, asked on the same rhythm as the inactivity clock.
  // requireUser asks on every navigation; this covers a page that stays open.
  useEffect(() => {
    let ending = false
    const check = () => {
      if (ending || !sessionExpired()) return
      ending = true
      void signOutForSessionLimit()
        .then(async () => {
          const search = new URLSearchParams({ reason: EXPIRED_REASON })
          const next = safeNextPath(here)
          if (next !== '/app') search.set('next', next)
          await navigate(`/login?${search}`, { replace: true })
          queryClient.clear()
        })
        // Offline: the next check tries again.
        .catch(() => {
          ending = false
        })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    const interval = window.setInterval(check, INACTIVITY_CHECK_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    check()
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
  }, [navigate, here])

  if (deadline === null) return null
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Still there?</AlertDialogTitle>
          <AlertDialogDescription>
            You’ll be signed out in <Countdown key={deadline} deadline={deadline} /> because you haven’t used Calsko for a while.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button autoFocus onClick={staySignedIn}>
            Stay signed in
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const secondsLeft = (deadline: number) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000))

function Countdown({ deadline }: { deadline: number }) {
  const [seconds, setSeconds] = useState(() => secondsLeft(deadline))
  useEffect(() => {
    const id = window.setInterval(() => setSeconds(secondsLeft(deadline)), 1000)
    return () => window.clearInterval(id)
  }, [deadline])
  return <span className="font-mono tabular-nums">{seconds}s</span>
}
