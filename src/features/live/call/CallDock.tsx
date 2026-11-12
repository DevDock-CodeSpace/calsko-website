import { ChevronUp, Maximize2, Minus, Move, PhoneOff } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { DockSpinner } from '@/components/DockSpinner'
import { Button } from '@/components/ui/button'
import { holdActivity } from '@/lib/inactivity'
import { cn } from '@/lib/utils'
import { LiveCallContext, useLiveCall, type ActiveCall } from './context'

// The Jitsi SDK is only downloaded once a call is active.
const JitsiRoom = lazy(() => import('../components/JitsiRoom'))

/** Holds the one active call so it survives navigation. Wrap the app shell in this. */
export function LiveCallProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<ActiveCall | null>(null)
  const [anchorEl, setAnchor] = useState<HTMLElement | null>(null)
  const [minimized, setMinimized] = useState(false)
  // A new call starts in view; ending one forgets the preference.
  const startCall = useCallback((next: ActiveCall) => {
    setMinimized(false)
    setCall(next)
  }, [])
  const endCall = useCallback(() => {
    setMinimized(false)
    setCall(null)
  }, [])
  // Coming back to the session page brings the call back into view; leaving it again floats it normally.
  const setAnchorEl = useCallback((el: HTMLElement | null) => {
    if (el) setMinimized(false)
    setAnchor(el)
  }, [])
  // Someone listening to a call touches nothing, and the call's own frame keeps its
  // clicks to itself: being in one counts as activity (lib/inactivity).
  const inCall = call !== null
  useEffect(() => (inCall ? holdActivity() : undefined), [inCall])
  const value = useMemo(
    () => ({ call, anchorEl, minimized, setMinimized, startCall, endCall, setAnchorEl }),
    [call, anchorEl, minimized, startCall, endCall, setAnchorEl],
  )
  return <LiveCallContext.Provider value={value}>{children}</LiveCallContext.Provider>
}

/**
 * The single, persistent home of the active call's iframe. Rendered once at the
 * app shell so it survives route changes. When the session page is open it
 * tracks that page's anchor box (docked); otherwise it floats bottom-right, and
 * can be minimized to a small pill (still connected) so it isn't in the way.
 */
export function CallDock() {
  const { call, anchorEl, minimized, setMinimized, endCall } = useLiveCall()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const miniRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const [miniPosition, setMiniPosition] = useState<{ left: number; top: number; sessionId: string } | null>(null)
  const docked = anchorEl !== null
  const hidden = minimized && !docked
  const position = miniPosition?.sessionId === call?.sessionId ? miniPosition : null
  const clampMiniPosition = useCallback((left: number, top: number) => {
    const rect = miniRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 280
    const height = rect?.height ?? 40
    const gutter = 8
    return {
      left: Math.max(gutter, Math.min(left, window.innerWidth - width - gutter)),
      top: Math.max(gutter, Math.min(top, window.innerHeight - height - gutter)),
    }
  }, [])

  useEffect(() => {
    if (!hidden || !position) return
    const keepOnScreen = () => {
      setMiniPosition((current) =>
        current?.sessionId === position.sessionId
          ? { ...clampMiniPosition(current.left, current.top), sessionId: current.sessionId }
          : current,
      )
    }
    window.addEventListener('resize', keepOnScreen)
    return () => window.removeEventListener('resize', keepOnScreen)
  }, [clampMiniPosition, hidden, position])

  const startMiniDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button')) return
    const rect = event.currentTarget.getBoundingClientRect()
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveMini = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId || !call) return
    const next = clampMiniPosition(start.left + event.clientX - start.x, start.top + event.clientY - start.y)
    event.currentTarget.style.left = `${next.left}px`
    event.currentTarget.style.top = `${next.top}px`
    event.currentTarget.style.right = 'auto'
    event.currentTarget.style.bottom = 'auto'
  }
  const stopMiniDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (call) setMiniPosition({ ...clampMiniPosition(rect.left, rect.top), sessionId: call.sessionId })
    drag.current = null
  }
  const moveMiniByKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    }
    const offset = offsets[event.key]
    if (!offset) return
    event.preventDefault()
    const rect = miniRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = position?.left ?? rect.left
    const top = position?.top ?? rect.top
    if (call) setMiniPosition({ ...clampMiniPosition(left + offset[0], top + offset[1]), sessionId: call.sessionId })
  }

  // While docked, follow the anchor's box every frame (covers scroll, resize and
  // the sidebar's open/close animation without extra listeners).
  useEffect(() => {
    if (!call || !anchorEl) return
    let raf = 0
    const follow = () => {
      const el = containerRef.current
      if (el) {
        const r = anchorEl.getBoundingClientRect()
        el.style.top = `${r.top}px`
        el.style.left = `${r.left}px`
        el.style.width = `${r.width}px`
        el.style.height = `${r.height}px`
      }
      raf = requestAnimationFrame(follow)
    }
    follow()
    return () => cancelAnimationFrame(raf)
  }, [call, anchorEl])

  // Clear the docked coordinates when switching to the floating layout.
  useEffect(() => {
    if (anchorEl || !containerRef.current) return
    const el = containerRef.current
    el.style.top = el.style.left = el.style.width = el.style.height = ''
  }, [anchorEl])

  if (!call) return null

  return (
    <>
      {/* Kept mounted while minimized (just hidden), so the call, its audio and its connection carry on. */}
      <div
        ref={containerRef}
        aria-hidden={hidden || undefined}
        inert={hidden}
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden bg-muted',
          // Docked it is part of the page (no frame); floating it is a window.
          !docked && 'right-4 bottom-4 h-[248px] w-[min(360px,calc(100vw-2rem))] rounded-xl border shadow-lg',
          hidden && 'pointer-events-none invisible',
        )}
      >
        {!docked && (
          <div className="flex items-center gap-1 border-b bg-background/95 py-1.5 pr-1.5 pl-2.5">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{call.title}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Hide call window" title="Hide (the call keeps running)" onClick={() => setMinimized(true)}>
              <Minus />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Return to meeting" title="Return to meeting" onClick={() => navigate(call.returnTo)}>
              <Maximize2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Leave call"
              title="Leave call"
              className="text-muted-foreground hover:text-destructive"
              onClick={endCall}
            >
              <PhoneOff />
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <Suspense fallback={<Connecting />}>
            <JitsiRoom
              jaas={call.jaas}
              subject={call.title}
              displayName={call.displayName}
              email={call.email}
              onLeave={endCall}
            />
          </Suspense>
        </div>
      </div>

      {hidden && (
        <div
          ref={miniRef}
          role="region"
          aria-label="Call in progress"
          onPointerDown={startMiniDrag}
          onPointerMove={moveMini}
          onPointerUp={stopMiniDrag}
          onPointerCancel={stopMiniDrag}
          onLostPointerCapture={stopMiniDrag}
          style={position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : undefined}
          className="fixed right-4 bottom-4 z-50 flex h-10 max-w-[calc(100vw-1rem)] items-center gap-0.5 rounded-full border bg-background py-1 pr-1 pl-3 shadow-lg"
        >
          <span className="mr-1.5 size-2 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
          <span
            role="group"
            tabIndex={0}
            aria-label="Move call indicator. Use arrow keys to move it."
            onKeyDown={moveMiniByKey}
            className="flex min-w-0 flex-1 cursor-move touch-none items-center gap-1.5 truncate text-xs font-medium outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <Move className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="max-w-40 truncate">{call.title}</span>
          </span>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Show call window" title="Show call" onClick={() => setMinimized(false)}>
            <ChevronUp />
          </Button>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Return to meeting" title="Return to meeting" onClick={() => navigate(call.returnTo)}>
            <Maximize2 />
          </Button>
          <Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground hover:text-destructive" aria-label="Leave call" title="Leave call" onClick={endCall}>
            <PhoneOff />
          </Button>
        </div>
      )}
    </>
  )
}

function Connecting() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <DockSpinner label={null} />
      Connecting…
    </div>
  )
}
