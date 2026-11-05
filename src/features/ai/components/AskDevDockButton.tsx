import { Sparkles } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentTeam } from '@/features/teams/hooks'
import { preloadable } from '@/lib/preloadable'

// The panel (and everything it needs) loads the first time it is opened, so
// the header carries only this button.
const panel = preloadable(() => import('./AskDevDockPanel'))
const AskDevDockPanel = panel.Component

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform)

/**
 * The header's Calsko AI button (⌘K / Ctrl+K). Shown only in groups with the ask_devdock feature flag
 * (AppLayout; the platform admin switches it per group). To turn the assistant off everywhere, set the
 * function's AI_ENABLED secret to "false"; the panel then says so.
 */
export function AskDevDockButton() {
  const { team } = useCurrentTeam()
  const [open, setOpen] = useState(false)
  // Stays true once opened, so closing keeps the conversation.
  const [loaded, setLoaded] = useState(false)
  const warmUp = () => {
    setLoaded(true)
    void panel.preload()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Chrome's autofill sends keydown events without a key.
      if ((event.key ?? '').toLowerCase() !== 'k' || !(isMac ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.defaultPrevented) return
      event.preventDefault()
      setLoaded(true)
      setOpen((value) => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            aria-label="Calsko AI"
            // Pointing at the button loads the panel and mounts it closed, so the click only opens it.
            onPointerEnter={warmUp}
            onFocus={warmUp}
            onClick={() => {
              setLoaded(true)
              setOpen(true)
            }}
          >
            <Sparkles />
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Calsko AI <kbd className="ml-1 font-mono text-[10px] opacity-70">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </TooltipContent>
      </Tooltip>
      {loaded && (
        <Suspense fallback={null}>
          {/* A new group is a new conversation: nothing said in one carries into another. */}
          <AskDevDockPanel key={team.id} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  )
}
