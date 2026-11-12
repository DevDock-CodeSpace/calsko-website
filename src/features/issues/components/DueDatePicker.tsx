import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Wraps a trigger with a hidden native date input whose calendar opens on click
 * (`showPicker()`), so a due date can be set inline anywhere.
 */
export function DueDatePicker({
  value,
  onChange,
  className,
  children,
}: {
  value: string | null
  onChange: (date: string | null) => void
  className?: string
  children: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const open = () => {
    try {
      input.current?.showPicker()
    } catch {
      input.current?.focus()
    }
  }
  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute inset-0 opacity-0 dark:scheme-dark"
      />
      <span onClick={open}>{children}</span>
    </span>
  )
}
