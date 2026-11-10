import { ArrowUpRight, ChevronLeft, ChevronRight, Copy, FileText, Pencil, Plus, Presentation } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type ReactNode, type WheelEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export type StackItem = {
  key: string
  kind: 'brief' | 'doc' | 'whiteboard'
  title: string
  /** The Brief's text (cut to 4 lines); other files show their meta only. */
  preview?: string
  meta: string
  to: string
  edit?: { onClick: () => void }
  quickEdit?: {
    value: string
    onChange: (value: string) => void
    onOpen: () => boolean
    onSave: () => void
    onCancel: () => void
    loading: boolean
    loaded: boolean
    saving: boolean
    canSave: boolean
    error?: string
    lockedBy?: string[]
    recentlyEditingBy?: string[]
    onTyping?: () => void
  }
}

const KIND: Record<StackItem['kind'], { label: string; icon: typeof FileText; chip: string; dot: string }> = {
  brief: { label: 'Brief', icon: FileText, chip: 'border-brand/40 bg-brand/10 text-brand', dot: 'bg-brand' },
  whiteboard: { label: 'Whiteboard', icon: Presentation, chip: 'border-violet-400/40 bg-violet-400/10 text-violet-500 dark:text-violet-300', dot: 'bg-violet-400' },
  doc: { label: 'Doc', icon: FileText, chip: 'border-teal-400/40 bg-teal-400/10 text-teal-600 dark:text-teal-300', dot: 'bg-teal-400' },
}

/**
 * A plan's files as a horizontal 3D stack (owner's choice, 2026-10-27): the file in focus sits flat
 * in the middle, its neighbours turn away left and right, inside a clipped row so nothing overlaps
 * the page. Plain CSS transforms on one piece of state: no library. ‹ › / dots / ← → (when focused)
 * / a sideways trackpad swipe move it; a vertical wheel is left to the page. Reduced motion: no glide.
 */
export function FileStack({ items, extra, newMenu }: { items: StackItem[]; extra?: ReactNode; newMenu: ReactNode }) {
  const [active, setActive] = useState(0)
  const lastSwipe = useRef(0)
  const at = Math.min(active, Math.max(0, items.length - 1))
  const go = (i: number) => setActive(Math.max(0, Math.min(items.length - 1, i)))

  const onWheel = (e: WheelEvent) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
    // Only a sideways swipe moves it; scrolling the page stays the page's.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 6) return
    const now = Date.now()
    if (now - lastSwipe.current < 450) return
    lastSwipe.current = now
    go(at + (e.deltaX > 0 ? 1 : -1))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
    if (e.key === 'ArrowRight') go(at + 1)
    else if (e.key === 'ArrowLeft') go(at - 1)
    else return
    e.preventDefault()
  }
  const copy = (to: string) => {
    void navigator.clipboard.writeText(new URL(to, window.location.origin).toString()).then(() => toast.success('Link copied'))
  }

  // One file has nothing to turn to: a plain card the width of the column, without the stage or its controls.
  const single = items.length === 1

  return (
    <section aria-label="Plan files" className="space-y-2.5">
      <div
        role="group"
        aria-roledescription={single ? undefined : 'carousel'}
        aria-label="Files"
        tabIndex={single ? undefined : 0}
        onWheel={single ? undefined : onWheel}
        onKeyDown={single ? undefined : onKeyDown}
        className={cn(
          'relative',
          !single &&
            'h-[264px] overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_60%_70%_at_50%_50%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_70%)] [perspective:1200px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        )}
      >
        {items.map((item, i) => {
          const d = i - at
          const far = Math.abs(d) >= 2
          const x = d === 0 ? 0 : Math.sign(d) * (far ? 560 : 300)
          const tilt = d === 0 ? 0 : -Math.sign(d) * (far ? 40 : 30)
          const scale = d === 0 ? 1 : far ? 0.72 : 0.84
          const kind = KIND[item.kind]
          const placed = {
            transform: `translate(-50%,-50%) translateX(${x}px) rotateY(${tilt}deg) scale(${scale})`,
            opacity: d === 0 ? 1 : far ? 0 : 0.42,
            zIndex: 10 - Math.abs(d),
            pointerEvents: far ? ('none' as const) : ('auto' as const),
          }
          return (
            <article
              key={item.key}
              aria-hidden={d !== 0}
              className={cn(
                'flex flex-col rounded-[18px] border px-5 pt-5 pb-4',
                single
                  ? 'min-h-48 w-full'
                  : 'absolute top-1/2 left-1/2 h-[232px] w-[min(440px,82%)] transition-[transform,opacity,box-shadow,border-color] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none',
                single
                  ? 'bg-card'
                  : d === 0
                    ? 'border-brand bg-card shadow-[0_0_0_1px_color-mix(in_oklab,var(--brand)_35%,transparent),0_18px_50px_-18px_color-mix(in_oklab,var(--brand)_55%,transparent),0_0_36px_-8px_color-mix(in_oklab,var(--brand)_45%,transparent)]'
                    : 'border-border bg-card shadow-[0_8px_30px_-12px_rgb(0_0_0/0.18)] dark:shadow-none',
              )}
              style={single ? undefined : placed}
            >
              <div className="flex items-center gap-2">
                <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium', kind.chip)}>
                  <kind.icon className="size-3.5" /> {kind.label}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={`Copy a link to ${item.title}`}
                  tabIndex={d === 0 ? 0 : -1}
                  onClick={() => copy(item.to)}
                  className="flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
              <h3 className="mt-3.5 truncate text-lg font-semibold tracking-tight">{item.title}</h3>
              {item.quickEdit ? (
                <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1">
                  {item.quickEdit.loading ? (
                    <p className="py-2 text-sm text-muted-foreground">Opening Brief…</p>
                  ) : item.quickEdit.error && !item.quickEdit.loaded ? (
                    <p role="alert" className="py-2 text-sm text-destructive">{item.quickEdit.error}</p>
                  ) : (
                    <>
                      {item.quickEdit.error && <p role="alert" className="text-xs text-destructive">{item.quickEdit.error}</p>}
                      {item.quickEdit.lockedBy && item.quickEdit.lockedBy.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {item.quickEdit.lockedBy.join(', ')} {item.quickEdit.lockedBy.length === 1 ? 'is' : 'are'} editing the Brief.
                        </p>
                      )}
                      {(!item.quickEdit.lockedBy || item.quickEdit.lockedBy.length === 0) && item.quickEdit.recentlyEditingBy && item.quickEdit.recentlyEditingBy.length > 0 && (
                        <p role="status" className="text-xs text-muted-foreground">
                          {item.quickEdit.recentlyEditingBy.join(', ')} {item.quickEdit.recentlyEditingBy.length === 1 ? 'was' : 'were'} editing the Brief. Open it to see their changes.
                        </p>
                      )}
                      <textarea
                        aria-label="Brief text"
                        autoFocus
                        value={item.quickEdit.value}
                        readOnly={Boolean(item.quickEdit.lockedBy?.length)}
                        onChange={(event) => {
                          item.quickEdit?.onChange(event.target.value)
                          item.quickEdit?.onTyping?.()
                        }}
                        className="min-h-16 w-full flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-brand/40 read-only:opacity-70"
                      />
                    </>
                  )}
                </div>
              ) : (
                <p className={cn('mt-1.5 line-clamp-4 text-sm leading-relaxed', item.preview ? 'text-muted-foreground' : 'text-muted-foreground/70 italic')}>
                  {item.preview ?? (item.kind === 'brief' ? 'What is this plan for, and what does done look like? Write it in the Brief.' : `A ${kind.label.toLowerCase()} in this plan’s folder.`)}
                </p>
              )}
              {!item.quickEdit && <span className="flex-1" />}
              <div className="flex items-center gap-2.5 border-t pt-3">
                <span className={cn('size-1.5 rounded-full', kind.dot)} />
                <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{item.meta}</span>
                {item.quickEdit ? (
                  <>
                    <Link
                      to={item.to}
                      tabIndex={d === 0 ? 0 : -1}
                      onClick={(event) => {
                        if (!item.quickEdit?.onOpen()) event.preventDefault()
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      tabIndex={d === 0 ? 0 : -1}
                      disabled={item.quickEdit.saving}
                      onClick={item.quickEdit.onCancel}
                      className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      tabIndex={d === 0 ? 0 : -1}
                      disabled={!item.quickEdit.canSave || item.quickEdit.saving}
                      onClick={item.quickEdit.onSave}
                      className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {item.quickEdit.saving ? 'Saving…' : 'Save'}
                    </button>
                  </>
                ) : (
                  <>
                    {item.edit && (
                      <button
                        type="button"
                        aria-label={`Edit ${item.title} here`}
                        tabIndex={d === 0 ? 0 : -1}
                        onClick={item.edit.onClick}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted"
                      >
                        <Pencil className="size-3.5" /> Edit here
                      </button>
                    )}
                    <Link
                      to={item.to}
                      tabIndex={d === 0 ? 0 : -1}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      Open <ArrowUpRight className="size-3.5" />
                    </Link>
                  </>
                )}
              </div>
              {d !== 0 && (
                <button type="button" aria-label={`Show ${item.title}`} onClick={() => go(i)} className="absolute inset-0 cursor-pointer rounded-[18px]" />
              )}
            </article>
          )
        })}
      </div>
      <div className={cn('flex flex-wrap items-center gap-3', single ? 'justify-start' : 'justify-center')}>
        {!single && (
          <>
            <button type="button" aria-label="Previous file" disabled={at === 0} onClick={() => go(at - 1)} className="flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40">
              <ChevronLeft className="size-4" />
            </button>
            {items.map((item, i) => (
              <button
                key={item.key}
                type="button"
                aria-label={`Show ${item.title}`}
                aria-current={i === at}
                onClick={() => go(i)}
                className={cn('h-1.5 rounded-full transition-[width,background-color] duration-300', i === at ? 'w-5 bg-brand' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60')}
              />
            ))}
            <button type="button" aria-label="Next file" disabled={at >= items.length - 1} onClick={() => go(at + 1)} className="flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40">
              <ChevronRight className="size-4" />
            </button>
            <span className="w-11 font-mono text-[11px] text-muted-foreground">
              {at + 1} / {items.length}
            </span>
          </>
        )}
        {extra}
        {newMenu}
      </div>
    </section>
  )
}

/** The dashed "+ New doc or whiteboard" trigger under the stack. */
export function NewFileButton(props: React.ComponentProps<'button'>) {
  return (
    <button type="button" {...props} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <Plus className="size-3.5" /> New doc or whiteboard
    </button>
  )
}
