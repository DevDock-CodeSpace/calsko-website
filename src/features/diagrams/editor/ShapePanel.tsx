import { Search, X } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CLOUD_PROVIDERS } from './cloud'
import { ICON_GROUPS, ICON_KEYS, ICONS } from './icons'
import { BLOCK_KINDS, blockLabels, SHAPE_KINDS, shapeLabels, type BlockKind, type LibraryItem } from './model'
import { itemKey } from './recent'
import { ShapeSvg } from './ShapeSvg'

/** dataTransfer type for dragging a library item onto the canvas. */
export const LIBRARY_DRAG_TYPE = 'application/x-devdock-diagram-item'

const containers = [
  { variant: 'solid', label: 'Group' },
  { variant: 'dashed', label: 'Zone' },
] as const

const SCHEMA: LibraryItem = { type: 'container', variant: 'dashed', label: 'public schema' }

const blockWords: Record<BlockKind, string[]> = {
  heading: ['title', 'text'],
  paragraph: ['text', 'description', 'sub-heading'],
  list: ['bullets', 'points', 'text', 'sub-heading'],
  table: ['database', 'schema', 'columns', 'entity', 'sql'],
}

/** Cloud provider icons are many: they're found by searching, not listed. */
const isCloud = (group: string) => (CLOUD_PROVIDERS as readonly string[]).includes(group)

/**
 * Left panel: "Recently used" first, then shapes, text, data, containers and
 * architecture icons. The AWS, Azure and Google Cloud icons show when searching
 * (and in Recently used once added). Click to add, or drag onto the canvas.
 */
export function ShapePanel({
  onAdd,
  recent,
  onForget,
}: {
  onAdd: (item: LibraryItem) => void
  recent: LibraryItem[]
  /** Removes an item from Recently used (its × button). */
  onForget: (item: LibraryItem) => void
}) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const searching = q !== ''
  const matches = (...words: string[]) => !q || words.some((w) => w.toLowerCase().includes(q))

  const shapes = SHAPE_KINDS.filter((kind) => matches(shapeLabels[kind], kind))
  const textBlocks = BLOCK_KINDS.filter((kind) => kind !== 'table' && matches(blockLabels[kind], kind, ...blockWords[kind]))
  const dataBlocks = BLOCK_KINDS.filter((kind) => kind === 'table' && matches(blockLabels[kind], kind, ...blockWords[kind]))
  // A schema is a zone to drop tables into.
  const schema = matches('Schema', 'database', 'namespace', 'tables')
  const groups = containers.filter((c) => matches(c.label, 'container'))
  const iconGroups = ICON_GROUPS.filter((group) => searching || !isCloud(group))
    .map((group) => ({
      group,
      keys: ICON_KEYS.filter((key) => ICONS[key].group === group && matches(ICONS[key].label, key, group)),
    }))
    .filter((g) => g.keys.length > 0)
  const empty =
    shapes.length === 0 && textBlocks.length === 0 && dataBlocks.length === 0 && !schema && groups.length === 0 && iconGroups.length === 0

  return (
    <aside className="hidden w-48 shrink-0 flex-col border-r bg-background md:flex" aria-label="Shapes">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              // Esc clears the search; on an empty box it leaves it, back to the canvas.
              e.stopPropagation()
              if (query) setQuery('')
              else e.currentTarget.blur()
            }}
            placeholder="Search shapes"
            aria-label="Search shapes"
            className={cn('h-8 pl-8 text-sm', query && 'pr-8')}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
              aria-label="Clear search"
              title="Clear search (Esc)"
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* Never sideways: every tile fits its column (long names wrap, see Tile). */}
      <div className="flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-2 pb-6">
        {!searching && recent.length > 0 && (
          <Section title="Recently used">
            {recent.map((item) => (
              // The × is beside the tile, not inside it: a button can't hold another.
              <div key={itemKey(item)} className="group/recent relative min-w-0">
                <ItemTile item={item} onAdd={onAdd} />
                <RemoveRecent item={item} onForget={onForget} />
              </div>
            ))}
          </Section>
        )}
        {shapes.length > 0 && (
          <Section title="Shapes">
            {shapes.map((shape) => (
              <ItemTile key={shape} item={{ type: 'shape', shape }} onAdd={onAdd} />
            ))}
          </Section>
        )}
        {textBlocks.length > 0 && (
          <Section title="Text">
            {textBlocks.map((block) => (
              <ItemTile key={block} item={{ type: 'block', block }} onAdd={onAdd} />
            ))}
          </Section>
        )}
        {(dataBlocks.length > 0 || schema) && (
          <Section title="Data">
            {dataBlocks.map((block) => (
              <ItemTile key={block} item={{ type: 'block', block }} onAdd={onAdd} />
            ))}
            {schema && <ItemTile item={SCHEMA} onAdd={onAdd} />}
          </Section>
        )}
        {groups.length > 0 && (
          <Section title="Containers">
            {groups.map(({ variant }) => (
              <ItemTile key={variant} item={{ type: 'container', variant }} onAdd={onAdd} />
            ))}
          </Section>
        )}
        {iconGroups.map(({ group, keys }) => (
          <Section key={group} title={group}>
            {keys.map((key) => (
              <ItemTile key={key} item={{ type: 'icon', icon: key }} onAdd={onAdd} short />
            ))}
          </Section>
        ))}
        {!searching && (
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            Search for AWS, Azure and Google Cloud icons, e.g. “lambda” or “cosmos”.
          </p>
        )}
        {empty && <p className="px-1 py-6 text-center text-xs text-muted-foreground">No shapes match “{query}”.</p>}
      </div>
    </aside>
  )
}

/** The small × on a Recently used tile: shown on hover or focus (always on touch screens). */
function RemoveRecent({ item, onForget }: { item: LibraryItem; onForget: (item: LibraryItem) => void }) {
  const name = tileLabel(item)
  return (
    <button
      type="button"
      onClick={() => onForget(item)}
      aria-label={`Remove ${name} from recently used`}
      title="Remove from recently used"
      className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover/recent:opacity-100 group-focus-within/recent:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none pointer-coarse:opacity-100"
    >
      <X className="size-2.5" strokeWidth={2.5} />
    </button>
  )
}

/** The name a tile shows for an item. */
function tileLabel(item: LibraryItem): string {
  if (item.type === 'shape') return shapeLabels[item.shape]
  if (item.type === 'block') return blockLabels[item.block]
  if (item.type === 'container') return item.label ? 'Schema' : item.variant === 'dashed' ? 'Zone' : 'Group'
  return (ICONS[item.icon] ?? ICONS.server).label
}

/** A tile for any library item: its picture and name. `short` drops the provider from a cloud icon's name (its section says it). */
function ItemTile({ item, onAdd, short }: { item: LibraryItem; onAdd: (item: LibraryItem) => void; short?: boolean }) {
  if (item.type === 'shape') {
    const shape = item.shape
    return (
      <Tile label={shapeLabels[shape]} item={item} onAdd={onAdd}>
        <div className="relative h-6 w-9">
          <ShapeSvg
            shape={shape}
            width={36}
            height={24}
            strokeWidth={1.25}
            className={cn(
              'fill-card stroke-foreground/60',
              shape === 'text' && 'fill-transparent stroke-transparent',
              shape === 'note' && 'fill-amber-50 stroke-amber-500 dark:fill-amber-950',
            )}
            detailClassName={shape === 'note' ? 'stroke-amber-500' : 'stroke-foreground/60'}
          />
          {shape === 'text' && <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">T</span>}
        </div>
      </Tile>
    )
  }
  if (item.type === 'block') {
    return (
      <Tile label={blockLabels[item.block]} item={item} onAdd={onAdd}>
        <BlockGlyph block={item.block} />
      </Tile>
    )
  }
  if (item.type === 'container') {
    if (item.label) {
      return (
        <Tile label="Schema" item={item} onAdd={onAdd}>
          <span className="flex h-6 w-9 items-start rounded-[4px] border-[1.25px] border-dashed border-foreground/60 p-[3px]">
            <span className="h-2.5 w-3.5 rounded-[2px] border border-foreground/50" />
          </span>
        </Tile>
      )
    }
    return (
      <Tile label={item.variant === 'dashed' ? 'Zone' : 'Group'} item={item} onAdd={onAdd}>
        <div
          className={cn('h-6 w-9 rounded-[4px] border-[1.25px] border-foreground/60', item.variant === 'solid' ? 'bg-muted' : 'border-dashed')}
        />
      </Tile>
    )
  }
  const { icon: Icon, src, label } = ICONS[item.icon] ?? ICONS.server
  return (
    <Tile label={short && src ? label.replace(/^(Amazon|AWS|Azure|Google) /, '') : label} item={item} onAdd={onAdd}>
      {Icon ? (
        <Icon className="size-5 text-foreground/80" strokeWidth={1.5} />
      ) : (
        // Downloaded only when shown; the tile, not the image, is what's dragged.
        <img src={src} alt="" loading="lazy" draggable={false} className="pointer-events-none size-6 object-contain" />
      )}
    </Tile>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 px-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{title}</h3>
      {/* Equal columns that tiles can't widen (minmax(0, 1fr) plus min-w-0 on the tiles). */}
      <div className="grid grid-cols-3 gap-1">{children}</div>
    </section>
  )
}

function Tile({
  label,
  item,
  onAdd,
  children,
}: {
  label: string
  item: LibraryItem
  onAdd: (item: LibraryItem) => void
  children: ReactNode
}) {
  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify(item))
    event.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => onAdd(item)}
      title={`${label}: click to add, or drag onto the canvas`}
      // One column wide whatever the label: min-w-0 + w-full keep a long name from pushing into the
      // next tile (or making the panel scroll sideways); it wraps onto a second line instead.
      className="flex h-[4.5rem] w-full min-w-0 cursor-grab flex-col items-center justify-start gap-1.5 rounded-md px-0.5 pt-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none active:cursor-grabbing"
    >
      <span className="flex h-6 shrink-0 items-center justify-center">{children}</span>
      <span className="line-clamp-2 w-full text-center text-[10px] leading-tight break-words">{label}</span>
    </button>
  )
}

/** A small picture of each block for its tile. */
function BlockGlyph({ block }: { block: BlockKind }) {
  const bar = 'h-[3px] rounded-full bg-foreground/50'
  if (block === 'heading') return <span className="text-[15px] leading-none font-bold text-foreground/80">H</span>
  if (block === 'table')
    return (
      <span className="flex h-6 w-9 flex-col overflow-hidden rounded-[3px] border-[1.25px] border-foreground/60">
        <span className="h-1.5 bg-foreground/40" />
        <span className="flex-1 border-b border-foreground/30" />
        <span className="flex-1" />
      </span>
    )
  return (
    <span className="flex w-9 flex-col gap-[3px]">
      <span className={cn(bar, 'w-5 bg-foreground/80')} />
      {[0, 1].map((i) => (
        <span key={i} className="flex items-center gap-1">
          {block === 'list' && <span className="size-[3px] shrink-0 rounded-full bg-foreground/60" />}
          <span className={cn(bar, 'flex-1 bg-foreground/35')} />
        </span>
      ))}
    </span>
  )
}
