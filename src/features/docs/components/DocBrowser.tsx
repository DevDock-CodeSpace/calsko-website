import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
  Presentation,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NameDialog } from '@/components/NameDialog'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/hooks'
import { useCollectionView } from '@/features/collections/hooks'
import type { DiagramSummary } from '@/features/diagrams/api'
import { CreateDiagramDialog } from '@/features/diagrams/components/CreateDiagramDialog'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  createFolder,
  deleteFolder,
  MAX_FOLDER_DEPTH,
  moveFolderItems,
  renameFolder,
  type DocFolder,
  type DocSummary,
} from '../api'
import {
  describeItems,
  diagramKey,
  docKey,
  DRAG_TYPE,
  dropBlocker,
  folderKey,
  itemsOf,
  type DragItems,
} from '../dragDrop'
import { folderPath, folderSubtree } from '../folders'
import { readFilesLocationState } from '../files-navigation'
import { useCanWriteDocs } from '../hooks'
import type { FileAccess } from '../sharing'
import { useSelection } from '../useSelection'
import { AccessChoice } from './AccessChoice'
import { CreateDocDialog } from './CreateDocDialog'
import { FileRowActions } from './FileRowActions'
import { FILE_HEADER, FILE_ROW } from './fileGrid'
import { MoveDocDialog } from './MoveDocDialog'
import { RestrictedMark } from './RestrictedMark'
import { ShareDialog } from './ShareDialog'

/** Hovering a folder this long while dragging opens it (like a file manager), so you can drop deeper. */
const SPRING_LOAD_MS = 800

type DocBrowserProps = {
  teamId: string
  /** The scope being browsed: a workspace, or group-wide (null). */
  workspaceId: string | null
  /** The scope's docs (also where the Docs tool is off, unshown: deleting a folder deletes them). */
  docs: DocSummary[]
  /** The scope's diagrams (empty when the Diagrams tool is off there). */
  diagrams: DiagramSummary[]
  folders: DocFolder[]
  /** The Docs tool is on in this scope: docs show, and can be made, here. */
  docsEnabled: boolean
  /** The Diagrams tool is on in this scope: diagrams show, and can be made, here. */
  diagramsEnabled: boolean
  /** Delete/move docs and diagrams, manage folders, and create diagrams (writers). */
  canWrite: boolean
  /** Create docs here (everyone who can edit docs in this scope). */
  canCreate: boolean
  docHref: (doc: DocSummary) => string
  diagramHref: (diagram: DiagramSummary) => string
  filesReturnTo: string
  filesState: ReturnType<typeof readFilesLocationState>
  /** Shown when the scope has nothing at all. */
  empty: ReactNode
  /** The place's name, the first step of the folder path ("Software Fundamentals › Week 1"). */
  rootLabel?: string
}

type Sort = { by: 'updated' | 'name'; dir: 'asc' | 'desc' }
type Row = { kind: 'doc'; item: DocSummary } | { kind: 'diagram'; item: DiagramSummary }

/**
 * Files (the UI name; code says docs) for one scope: folders (3 levels deep) holding docs and
 * diagrams side by side, always shown together (no kind filter: the owner found two filters
 * confusing). One toolbar (what's here or the folder path, search, one "New" menu) and one
 * sortable list whose rows line up (fileGrid).
 * Writers move things like in a file manager: drag onto a folder or the path (hover a folder to
 * open it), select several (the icon turns into a checkbox; Ctrl/⌘/Shift-click) and drag them
 * together, or "Move to…"; moves can be undone. The open folder (?folder=) is in the URL; the
 * search is not (it's a moment's lookup).
 */
export function DocBrowser({
  teamId,
  workspaceId,
  docs,
  diagrams,
  folders,
  docsEnabled,
  diagramsEnabled,
  canWrite,
  canCreate,
  docHref,
  diagramHref,
  filesReturnTo,
  filesState,
  empty,
  rootLabel = 'Files',
}: DocBrowserProps) {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [now] = useState(Date.now)
  const requested = params.get('folder')
  // A stale or foreign folder id falls back to the top level.
  const current = folders.find((f) => f.id === requested) ?? null
  const path = folderPath(current?.id ?? null, folders)
  const rootName = rootLabel
  const entries = useMemo(() => ({ docs, diagrams: diagramsEnabled ? diagrams : [] }), [docs, diagrams, diagramsEnabled])
  const [query, setQuery] = useState(filesState?.filesSearch ?? '')
  const searching = query.trim() !== ''
  const [sort, setSort] = useState<Sort>(filesState?.filesSort ?? { by: 'updated', dir: 'desc' })

  /** The scope's docs (where the Docs tool is on) and diagrams, optionally only those directly in one folder. */
  const rowsOf = (folderId?: string | null): Row[] => [
    ...(docsEnabled
      ? docs.filter((d) => folderId === undefined || d.folder_id === folderId).map((item) => ({ kind: 'doc' as const, item }))
      : []),
    ...entries.diagrams.filter((d) => folderId === undefined || d.folder_id === folderId).map((item) => ({ kind: 'diagram' as const, item })),
  ]
  const needle = query.trim().toLowerCase()
  const matches = (text: string) => text.toLowerCase().includes(needle)
  // The list: this folder's own items, or everything in the scope that matches the search. At the
  // top of a place, loose docs and diagrams come after the folders, under "Not in a folder".
  const pool = searching ? rowsOf().filter((r) => matches(r.item.title)) : rowsOf(current?.id ?? null)
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  const order = sort.dir === 'asc' ? 1 : -1
  const rows = pool.sort((a, b) => order * (sort.by === 'name' ? byName(a.item.title, b.item.title) : a.item.updated_at.localeCompare(b.item.updated_at)))
  /**
   * When a folder last changed, as people mean it: the newest of the folder itself and everything
   * inside it, subfolders included (renaming a doc deep inside counts).
   */
  const folderChanged = useMemo(() => {
    const latest = new Map<string, string>()
    const bump = (folderId: string | null, at: string) => {
      for (let f = folders.find((x) => x.id === folderId); f; f = folders.find((x) => x.id === f?.parent_id)) {
        if ((latest.get(f.id) ?? '') < at) latest.set(f.id, at)
      }
    }
    for (const f of folders) bump(f.id, f.updated_at)
    for (const d of docs) bump(d.folder_id, d.updated_at)
    for (const d of entries.diagrams) bump(d.folder_id, d.updated_at)
    return latest
  }, [folders, docs, entries.diagrams])
  const changedAt = (folder: DocFolder) => folderChanged.get(folder.id) ?? folder.updated_at
  const shownFolders = (searching ? folders.filter((f) => matches(f.name)) : folders.filter((f) => f.parent_id === (current?.id ?? null))).sort(
    (a, b) => order * (sort.by === 'name' ? byName(a.name, b.name) : changedAt(a).localeCompare(changedAt(b))),
  )
  const looseLabel = !current && !searching && shownFolders.length > 0 && rows.length > 0
  const canNest = (current?.depth ?? 0) < MAX_FOLDER_DEPTH
  const scopeIsEmpty = folders.length === 0 && rowsOf().length === 0
  // What's here, for the toolbar: everything at the top level, or inside this folder and its subfolders.
  const within = current ? folderSubtree(current.id, folders) : null
  const fileCount = within ? rowsOf().filter((r) => r.item.folder_id !== null && within.has(r.item.folder_id)).length : rowsOf().length
  const folderCount = within ? within.size - 1 : folders.length

  // Who may make a diagram here. At a group's top level the new diagram may go in any workspace the
  // person writes in (the dialog asks); inside a folder or a workspace it's this scope's writers.
  const canWriteIn = useCanWriteDocs()
  const { workspaces } = useCollectionView()
  const canNewDiagram =
    diagramsEnabled &&
    (workspaceId !== null || current ? canWrite : canWriteIn(null) || workspaces.some((w) => canWriteIn(w.id)))
  const canNewDoc = docsEnabled && canCreate
  const canNewFolder = canWrite && canNest && !searching
  const [creating, setCreating] = useState<'doc' | 'diagram' | null>(null)

  // What a move or delete can change: the lists and the folders, never an open doc or its images.
  const refresh = () =>
    Promise.all(
      [['documents', 'team'], ['documents', 'workspace'], ['documents', 'folders'], ['diagrams', 'team'], ['diagrams', 'workspace']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )
  const setParam = (key: string, value: string | null) =>
    setParams((p) => {
      if (value) p.set(key, value)
      else p.delete(key)
      return p
    })
  const open = (folderId: string | null) => {
    setQuery('')
    setParam('folder', folderId)
  }
  const sortBy = (by: Sort['by']) =>
    setSort((s) => (s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'name' ? 'asc' : 'desc' }))

  // ------------------------------------------------------------ dialogs
  const { user } = useAuth()
  const [naming, setNaming] = useState<{ mode: 'create' } | { mode: 'rename'; folder: DocFolder } | null>(null)
  // Who can open a new folder (chosen in the New folder dialog), and the folder being shared.
  const [folderAccess, setFolderAccess] = useState<FileAccess>('place')
  const [sharingFolder, setSharingFolder] = useState<DocFolder | null>(null)
  const [moving, setMoving] = useState<DragItems | null>(null)
  const [deleting, setDeleting] = useState<DocFolder | null>(null)
  const [busy, setBusy] = useState(false)
  const toDelete = deleting ? folderSubtree(deleting.id, folders) : new Set<string>()
  const docsToDelete = docs.filter((d) => d.folder_id && toDelete.has(d.folder_id))
  const diagramsToDelete = entries.diagrams.filter((d) => d.folder_id && toDelete.has(d.folder_id))

  const removeFolder = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      // Step out of the folder first if we're inside it.
      if (current && toDelete.has(current.id)) open(deleting.parent_id)
      await deleteFolder(teamId, deleting.id, {
        docIds: docsToDelete.map((d) => d.id),
        diagramIds: diagramsToDelete.map((d) => d.id),
      })
      toast.success(`${deleting.name} was deleted`)
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
      setDeleting(null)
    }
  }

  // ------------------------------------------------------------ selection
  const rowKey = (row: Row) => (row.kind === 'doc' ? docKey(row.item.id) : diagramKey(row.item.id))
  // Plan folders (and the Plans folder) aren't selectable: they follow their plans.
  const keys = useMemo(
    () => [...shownFolders.filter((f) => !followsItsOwner(f)).map((f) => folderKey(f.id)), ...rows.map(rowKey)],
    [shownFolders, rows],
  )
  const selection = useSelection(keys)
  useEffect(() => {
    if (selection.count === 0) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selection.clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])
  /** A Ctrl/⌘ or Shift click selects instead of opening. */
  const selectClick = (key: string) => (event: MouseEvent) => {
    if (canWrite && selection.click(key, event)) event.preventDefault()
  }

  // ------------------------------------------------------------ moving
  const targetName = (folderId: string | null) => folders.find((f) => f.id === folderId)?.name ?? rootName

  const move = async (items: DragItems, targetId: string | null, origin: string | null) => {
    const blocked = dropBlocker(items, targetId, folders, entries)
    if (blocked) {
      if (blocked !== 'Already here') toast.error(blocked)
      return
    }
    const what = describeItems(items, entries, folders)
    try {
      await moveFolderItems({ ...items, targetId })
      selection.clear()
      await refresh()
      toast.success(`Moved ${what} to ${targetName(targetId)}`, {
        action: {
          label: 'Undo',
          onClick: () => {
            moveFolderItems({ ...items, targetId: origin })
              .then(() => refresh())
              .catch((error: unknown) => toast.error(errorMessage(error)))
          },
        },
      })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  // ------------------------------------------------------------ drag & drop
  // What is being dragged is kept in state: the browser hides dataTransfer's contents until the drop,
  // and we need it while hovering to tell which folders accept it.
  const [dragging, setDragging] = useState<{ items: DragItems; origin: string | null } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const spring = useRef<{ target: string | null; timer: number | undefined }>({ target: null, timer: undefined })
  const disarmSpring = () => {
    window.clearTimeout(spring.current.timer)
    spring.current = { target: null, timer: undefined }
  }
  useEffect(() => () => window.clearTimeout(spring.current.timer), [])

  const dragId = useRef(0)
  const startDrag = (event: DragEvent, key: string) => {
    // Dragging something that isn't selected drags just that one and leaves the selection alone, like
    // Explorer or Finder. (Changing the selection here would insert the selection bar and shift the
    // list under the cursor, which makes the browser cancel the drag.)
    const items = itemsOf(selection.has(key) ? selection.selected : [key])
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(items))
    event.dataTransfer.effectAllowed = 'move'
    // A small label instead of a faded copy of the whole row.
    const ghost = document.createElement('div')
    ghost.textContent = describeItems(items, entries, folders).replace(/[“”]/g, '')
    ghost.className = 'fixed -top-96 left-0 max-w-64 truncate rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-lg'
    document.body.append(ghost)
    event.dataTransfer.setDragImage(ghost, 12, 12)
    window.setTimeout(() => ghost.remove(), 0)
    // The styling that follows (dimmed rows, drop targets) is applied a moment later: changing the
    // dragged row's DOM inside dragstart can cancel the drag. A drag that already ended is ignored.
    const id = ++dragId.current
    window.setTimeout(() => {
      if (dragId.current === id) setDragging({ items, origin: current?.id ?? null })
    }, 0)
  }
  const endDrag = () => {
    dragId.current += 1
    setDragging(null)
    setDropTarget(null)
    disarmSpring()
  }

  const blockerFor = (folderId: string | null) => (dragging ? dropBlocker(dragging.items, folderId, folders, entries) : null)
  const dropProps = (folderId: string | null, springLoad = false) =>
    canWrite
      ? {
          onDragOver: (e: DragEvent) => {
            if (!dragging) return
            if (blockerFor(folderId) !== null) {
              e.dataTransfer.dropEffect = 'none'
              return
            }
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(folderId ?? 'top')
            if (springLoad && folderId && spring.current.target !== folderId) {
              disarmSpring()
              spring.current.target = folderId
              spring.current.timer = window.setTimeout(() => {
                open(folderId)
                disarmSpring()
              }, SPRING_LOAD_MS)
            }
          },
          onDragLeave: (e: DragEvent) => {
            // Moving between a row's own children doesn't count as leaving it.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
            setDropTarget(null)
            disarmSpring()
          },
          onDrop: (e: DragEvent) => {
            if (!dragging) return
            e.preventDefault()
            const { items, origin } = dragging
            endDrag()
            void move(items, folderId, origin)
          },
        }
      : {}
  const isDropTarget = (folderId: string | null) => dropTarget === (folderId ?? 'top')
  /** Dim a folder that can't take what's being dragged. */
  const refuses = (folderId: string) => {
    const reason = blockerFor(folderId)
    return reason !== null && reason !== 'Already here'
  }
  const isDragged = (key: string) =>
    dragging !== null &&
    (dragging.items.docIds.map(docKey).includes(key) ||
      dragging.items.diagramIds.map(diagramKey).includes(key) ||
      dragging.items.folderIds.map(folderKey).includes(key))

  /** "3 docs · 2 whiteboards · 1 folder": what a folder holds directly ("Empty" only when it holds nothing). */
  const summary = (folder: DocFolder) => {
    const inside = rowsOf(folder.id)
    const parts = [
      [inside.filter((r) => r.kind === 'doc').length, 'doc'],
      [inside.filter((r) => r.kind === 'diagram').length, 'diagram'],
      [folders.filter((f) => f.parent_id === folder.id).length, 'folder'],
    ] as const
    const text = parts.filter(([n]) => n > 0).map(([n, word]) => plural(n, word))
    return text.length ? text.join(' · ') : 'Empty'
  }
  /** Where a search result lives: "Testing › Week 1", or the top level. */
  const placeOf = (folderId: string | null) => folderPath(folderId, folders).map((f) => f.name).join(' › ') || rootName

  // `selectable` false: no checkbox (a plan's folder isn't moved or deleted by hand).
  const lead = (key: string, Icon: LucideIcon, label: string, iconClass?: string, selectable = true) => (
    <span className="relative z-10 flex size-7 items-center justify-center">
      <Icon
        className={cn(
          'size-4 transition-opacity',
          iconClass,
          canWrite && selectable && (selection.count > 0 ? 'opacity-0' : 'group-hover:opacity-0 [@media(hover:none)]:opacity-0'),
        )}
      />
      {canWrite && selectable && (
        <input
          type="checkbox"
          aria-label={`Select ${label}`}
          checked={selection.has(key)}
          onChange={() => selection.toggle(key)}
          className={cn(
            'absolute size-4 cursor-pointer accent-[var(--brand)] transition-opacity focus-visible:opacity-100',
            selection.count > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        />
      )}
    </span>
  )

  const newMenu = (canNewDoc ? 1 : 0) + (canNewDiagram ? 1 : 0) + (canNewFolder ? 1 : 0)
  const sortIcon = (by: Sort['by']) =>
    sort.by === by ? sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null

  return (
    <div>
      {/* Toolbar: what's on show, search, New. While selecting, the selection's own actions. */}
      <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b">
        {selection.count > 0 ? (
          <div role="status" className="flex h-10 flex-1 items-center gap-2 text-sm">
            <span className="font-medium">{selection.count} selected</span>
            <Button size="xs" variant="outline" onClick={() => setMoving(itemsOf(selection.selected))}>
              <FolderInput /> Move to…
            </Button>
            {selection.count < keys.length && (
              <Button size="xs" variant="ghost" onClick={selection.all}>
                Select all
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={selection.clear}>
              Clear
            </Button>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Drag a selected item to move them all</span>
          </div>
        ) : (
          <>
            {current && !searching ? (
              // Inside a folder: its path (each step above is a drop target, to move things out).
              <nav aria-label="Folder path" className="flex h-10 min-w-0 flex-wrap items-center gap-0.5 text-sm">
                {[null, ...path].map((folder, i) => {
                  const last = i === path.length
                  return (
                    <span key={folder?.id ?? 'top'} className="flex min-w-0 items-center gap-0.5">
                      {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                      <button
                        type="button"
                        onClick={() => open(folder?.id ?? null)}
                        aria-current={last ? 'page' : undefined}
                        className={cn(
                          'max-w-48 truncate rounded-sm px-1.5 py-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand/40',
                          i === 0 && '-ml-1.5',
                          last ? 'font-semibold' : 'text-muted-foreground',
                          isDropTarget(folder?.id ?? null) && !last && 'bg-brand/10 ring-1 ring-brand',
                          dragging && !last && blockerFor(folder?.id ?? null) !== null && 'opacity-50',
                        )}
                        {...(last ? {} : dropProps(folder?.id ?? null))}
                      >
                        {folder?.name ?? rootName}
                      </button>
                    </span>
                  )
                })}
              </nav>
            ) : (
              <p className="flex h-10 items-center font-mono text-xs text-muted-foreground">
                {searching
                  ? `${plural(rows.length, 'file')} and ${plural(shownFolders.length, 'folder')} match`
                  : `${plural(fileCount, 'file')}${folderCount > 0 ? ` · ${plural(folderCount, 'folder')}` : ''}`}
              </p>
            )}
            <div className="ml-auto flex items-center gap-2 pb-1.5 sm:pb-0">
              <label className="flex h-8 w-44 items-center gap-2 rounded-md border bg-background px-2 text-sm focus-within:ring-2 focus-within:ring-brand/40 sm:w-56">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                  placeholder="Search files"
                  aria-label="Search files"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
                {searching && (
                  <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
              {newMenu > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm">
                      <Plus /> New <ChevronDown className="opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {canNewDoc && (
                      <DropdownMenuItem onSelect={() => setCreating('doc')}>
                        <FileText /> Doc
                      </DropdownMenuItem>
                    )}
                    {canNewDiagram && (
                      <DropdownMenuItem onSelect={() => setCreating('diagram')}>
                        <Presentation /> Whiteboard
                      </DropdownMenuItem>
                    )}
                    {canNewFolder && (canNewDoc || canNewDiagram) && <DropdownMenuSeparator />}
                    {canNewFolder && (
                      <DropdownMenuItem onSelect={() => { setFolderAccess('place'); setNaming({ mode: 'create' }) }}>
                        <FolderPlus /> Folder
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </>
        )}
      </div>

      {shownFolders.length === 0 && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
          <Folder className="size-8 text-muted-foreground/40" />
          {searching
            ? `Nothing matches “${query.trim()}”.`
            : current
                ? 'This folder is empty.'
                : scopeIsEmpty
                  ? empty
                  : 'Nothing here.'}
        </div>
      ) : (
        <div className={cn(canWrite && 'select-none')}>
          <div className={FILE_HEADER}>
            <span />
            <button type="button" onClick={() => sortBy('name')} className="flex items-center gap-1 justify-self-start uppercase outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline">
              Name {sortIcon('name')}
            </button>
            <span className="hidden md:block">Owner</span>
            <button type="button" onClick={() => sortBy('updated')} className="flex items-center gap-1 justify-self-end uppercase outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline">
              Updated {sortIcon('updated')}
            </button>
            <span className="hidden md:block" />
          </div>
          <ul>
            {shownFolders.map((folder) => {
              const key = folderKey(folder.id)
              // The Plans folder and plan folders follow their plans (renamed and deleted with them).
              const planFolder = followsItsOwner(folder)
              return (
                <li
                  key={folder.id}
                  data-file-row=""
                  data-selected={selection.has(key) || undefined}
                  draggable={canWrite && !searching && !planFolder}
                  onDragStart={(e) => startDrag(e, key)}
                  onDragEnd={endDrag}
                  {...dropProps(folder.id, true)}
                  className={cn(
                    FILE_ROW,
                    selection.has(key) && 'bg-brand/5',
                    isDragged(key) && 'opacity-40',
                    dragging && refuses(folder.id) && 'opacity-50',
                    isDropTarget(folder.id) && 'bg-brand/10 ring-1 ring-brand ring-inset',
                  )}
                >
                  {lead(key, Folder, folder.name, 'fill-muted-foreground/15 text-muted-foreground', !planFolder)}
                  <span className="flex min-w-0 flex-col">
                    <button
                      type="button"
                      onClick={(e) => {
                        if (canWrite && !planFolder && selection.click(key, e)) return
                        open(folder.id)
                      }}
                      className="min-w-0 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0"
                    >
                      {folder.name}
                    </button>
                    <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                      {folder.access === 'restricted' && <RestrictedMark />}
                      {searching ? `in ${placeOf(folder.parent_id)}` : summary(folder)}
                      {folder.plan_id && <span>· Plan’s folder</span>}
                      {folder.lesson_id && <span>· Lesson’s folder</span>}
                    </span>
                  </span>
                  <span className="hidden md:block" />
                  <span className="text-right font-mono text-xs text-muted-foreground" title="Newest change inside">
                    {timeAgo(changedAt(folder), now)}
                  </span>
                  <span className="hidden justify-self-end md:block">
                    {canWrite && !planFolder && (
                      <RowMenu label={`${folder.name} actions`}>
                        <DropdownMenuItem onSelect={() => setSharingFolder(folder)}>Share…</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setNaming({ mode: 'rename', folder })}>Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setMoving({ docIds: [], diagramIds: [], folderIds: [folder.id] })}>Move to…</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(folder)}>
                          Delete
                        </DropdownMenuItem>
                      </RowMenu>
                    )}
                  </span>
                </li>
              )
            })}
            {looseLabel && (
              <li aria-hidden className="flex h-8 items-end border-b px-3 pb-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                Not in a folder
              </li>
            )}
            {rows.map((row) => {
              const key = rowKey(row)
              const { item } = row
              return (
                <li
                  key={key}
                  data-file-row=""
                  data-selected={selection.has(key) || undefined}
                  draggable={canWrite}
                  onDragStart={(e) => startDrag(e, key)}
                  onDragEnd={endDrag}
                  className={cn(FILE_ROW, selection.has(key) && 'bg-brand/5', isDragged(key) && 'opacity-40')}
                >
                  {lead(key, row.kind === 'doc' ? FileText : Presentation, item.title, 'text-muted-foreground')}
                  <span className="flex min-w-0 flex-col">
                    <Link
                      to={row.kind === 'doc' ? docHref(row.item) : diagramHref(row.item)}
                      state={{ filesReturnTo, filesSearch: query, filesSort: sort }}
                      draggable={false}
                      onClick={selectClick(key)}
                      className="min-w-0 truncate text-sm font-medium outline-none after:absolute after:inset-0"
                    >
                      {item.title}
                    </Link>
                    <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                      {item.access === 'restricted' && <RestrictedMark />}
                      {row.kind === 'doc' ? 'Doc' : 'Whiteboard'}
                      {searching && ` · in ${placeOf(item.folder_id)}`}
                    </span>
                  </span>
                  <span className="hidden min-w-0 items-center gap-2 md:flex">
                    <PersonAvatar profile={item.author} className="size-5" />
                    <span className="truncate text-xs text-muted-foreground">{item.author?.display_name ?? 'Former member'}</span>
                  </span>
                  <span className="text-right font-mono text-xs text-muted-foreground">{timeAgo(item.updated_at, now)}</span>
                  <span className="hidden justify-self-end md:block">
                    {(canWrite || item.created_by === user.id) && <FileRowActions kind={row.kind} item={item} folders={folders} canWrite={canWrite} />}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {creating === 'doc' && (
        <CreateDocDialog workspaceId={workspaceId ?? undefined} folderId={current?.id ?? null} open onOpenChange={(o) => !o && setCreating(null)} />
      )}
      {creating === 'diagram' && (
        <CreateDiagramDialog workspaceId={workspaceId ?? undefined} folderId={current?.id ?? null} open onOpenChange={(o) => !o && setCreating(null)} />
      )}
      <NameDialog
        key={naming ? (naming.mode === 'rename' ? `rename-${naming.folder.id}` : 'create') : 'name-closed'}
        open={naming !== null}
        onOpenChange={(o) => !o && setNaming(null)}
        title={naming?.mode === 'rename' ? `Rename “${naming.folder.name}”` : 'New folder'}
        description={
          naming?.mode === 'rename'
            ? 'Everyone who can see what’s inside sees the new name.'
            : `In ${current?.name ?? rootName}. Folders hold docs and whiteboards, and can be nested ${MAX_FOLDER_DEPTH} levels deep.`
        }
        initialName={naming?.mode === 'rename' ? naming.folder.name : ''}
        submitLabel={naming?.mode === 'rename' ? 'Rename' : 'Create folder'}
        placeholder="Week 1"
        onSubmit={async (name) => {
          if (naming?.mode === 'rename') await renameFolder(naming.folder.id, name)
          else await createFolder({ teamId, workspaceId, parentId: current?.id ?? null, name, access: folderAccess })
          await refresh()
        }}
      >
        {naming?.mode === 'create' && <AccessChoice value={folderAccess} onChange={setFolderAccess} placeName={rootName} />}
      </NameDialog>
      {sharingFolder && (
        <ShareDialog kind="folder" item={{ ...sharingFolder, title: sharingFolder.name }} open onOpenChange={(o) => !o && setSharingFolder(null)} />
      )}
      <MoveDocDialog
        key={moving ? `move-${[...moving.docIds, ...moving.diagramIds, ...moving.folderIds].join(',')}` : 'move-closed'}
        open={moving !== null}
        onOpenChange={(o) => !o && setMoving(null)}
        title={moving ? describeItems(moving, entries, folders) : ''}
        currentFolderId={current?.id ?? null}
        folders={folders}
        blocker={(folderId) => (moving ? dropBlocker(moving, folderId, folders, entries) : null)}
        onMove={async (folderId) => {
          if (moving) await move(moving, folderId, current?.id ?? null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description={
          toDelete.size - 1 + docsToDelete.length + diagramsToDelete.length === 0
            ? 'The folder is empty. This can’t be undone.'
            : `Everything inside goes too: ${listOf(
                [
                  [toDelete.size - 1, 'folder'] as const,
                  [docsToDelete.length, 'doc'] as const,
                  [diagramsToDelete.length, 'whiteboard'] as const,
                ]
                  .filter(([n]) => n > 0)
                  .map(([n, word]) => plural(n, word)),
              )}. This can’t be undone.`
        }
        confirmLabel="Delete folder"
        pending={busy}
        onConfirm={() => void removeFolder()}
      />
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`)

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="relative z-10 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Plan and lesson folders (and the Plans and Lessons folders) follow their plan or lesson: no moving, renaming or deleting by hand. */
function followsItsOwner(folder: DocFolder) {
  return folder.plan_id !== null || folder.is_plans_root || folder.lesson_id !== null || folder.is_lessons_root
}
