import { useEffect, useRef } from 'react'

// Linear-style single-key shortcuts for the issue screens.

/** Keys as written in handler maps: "c", "shift+c", "?", "arrowdown", "enter", "escape". */
function keyName(event: KeyboardEvent) {
  const key = (event.key ?? '').toLowerCase()
  if (key === '?') return '?'
  return event.shiftKey && key.length === 1 ? `shift+${key}` : key
}

/**
 * Typing in a field, or a menu/dialog is open: shortcuts stay out of the way.
 * Only *open* overlays count; Radix keeps closing ones in the DOM (data-state
 * "closed") during their exit animation, which would swallow the next key.
 */
function isBusy(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return true
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-slot="popover-content"][data-state="open"]',
    ) !== null
  )
}

/**
 * Binds single-key shortcuts on the window (no ⌘/Ctrl/Alt combos, so browser
 * shortcuts keep working). Handlers can change every render; the latest are used.
 */
export function useShortcuts(handlers: Record<string, () => void>, enabled = true) {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      if (isBusy(event)) return
      const handler = latest.current[keyName(event)]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/**
 * j/k (↓/↑) focus for issue rows and cards, in on-screen order: the DOM order
 * of elements marked data-issue-row (list groups top-down, board columns left
 * to right), so collapsed groups are skipped automatically.
 */
export function moveIssueFocus(activeId: string | null, delta: 1 | -1): string | null {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-issue-row]')]
  if (rows.length === 0) return null
  const index = rows.findIndex((r) => r.dataset.issueRow === activeId)
  const next = rows[index === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + delta))]
  next.scrollIntoView({ block: 'nearest' })
  return next.dataset.issueRow ?? null
}

export const SHORTCUTS: { group: string; items: [keys: string, action: string][] }[] = [
  {
    group: 'Issues',
    items: [
      ['C', 'New issue'],
      ['J / ↓', 'Next issue'],
      ['K / ↑', 'Previous issue'],
      ['Enter', 'Open issue'],
      ['F', 'Filter'],
    ],
  },
  {
    group: 'Selected or open issue',
    items: [
      ['S', 'Change status'],
      ['P', 'Set priority'],
      ['A', 'Assign'],
      ['I', 'Assign to me'],
      ['L', 'Labels'],
      ['⇧C', 'Move to sprint'],
      ['Esc', 'Back to the list'],
    ],
  },
  { group: 'Anywhere', items: [['?', 'Keyboard shortcuts'], ['⌘↵', 'Create / comment']] },
]
