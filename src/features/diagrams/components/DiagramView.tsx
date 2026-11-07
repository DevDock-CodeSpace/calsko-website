import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { OthersTypingAlert } from '@/components/OthersTypingAlert'
import { Button } from '@/components/ui/button'
import { foldersQuery } from '@/features/docs/api'
import { DocScope } from '@/features/docs/components/DocScope'
import { ShareButton } from '@/features/docs/components/ShareButton'
import { folderPath } from '@/features/docs/folders'
import { readFilesLocationState } from '@/features/docs/files-navigation'
import { useCurrentTeam } from '@/features/teams/hooks'
import { useOthersTyping } from '@/hooks/use-others-typing'
import { filesPath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'
import { sameJson } from '@/lib/json'
import { timeSince } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Json } from '@/types/database.types'
import { deleteDiagram, diagramQuery, updateDiagram, type Diagram } from '../api'
import { DiagramEditor } from '../editor/DiagramEditor'
import { parse } from '../editor/model'
import { ownSave, ownWrite } from '@/lib/realtime'

const AUTOSAVE_MS = 1000

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

/**
 * The diagram page body (lazy-loaded with React Flow): title bar + editor.
 * Writers' changes autosave; leaving flushes the save first. Everyone else
 * gets the same canvas read-only. `embedded` (a lesson's Whiteboard tab) drops the
 * title bar for a slim status line and fills its parent instead of the window.
 */
export default function DiagramView({ diagram, canWrite, embedded = false }: { diagram: Diagram; canWrite: boolean; embedded?: boolean }) {
  const { workspaceId } = useParams()
  const { team } = useCurrentTeam()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [now] = useState(Date.now)
  const listPath = filesPath(team.slug, workspaceId)
  const filesState = readFilesLocationState(location.state, listPath)
  // Folders are asked for only when the diagram is in one (most aren't); the path fills in when they arrive.
  const folders = useQuery({ ...foldersQuery(diagram.team_id, diagram.workspace_id), enabled: diagram.folder_id !== null }).data ?? []
  const path = folderPath(diagram.folder_id, folders)
  const folderLink = (folderId: string | null) => filesPath(team.slug, workspaceId, { folder: folderId })
  // Back (and after deleting): the folder the diagram is in, in Files.
  const backTo = filesState?.filesReturnTo ?? folderLink(diagram.folder_id)
  const [initial, setInitial] = useState(() => parse(diagram.data))

  // ------------------------------------------------------------ autosave
  const [title, setTitle] = useState(diagram.title)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const titleRef = useRef(diagram.title)
  const dataRef = useRef<Json>(diagram.data)
  const version = useRef(0) // bumped on every edit
  const savedVersion = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  const leaving = useRef(false)
  // What the server has, as far as this view knows (the last load, save, or adopted change).
  const synced = useRef({ title: diagram.title, data: diagram.data })

  const save = useCallback(async () => {
    const target = version.current
    if (target === savedVersion.current) return
    const nextTitle = titleRef.current.trim()
    if (!nextTitle) {
      setStatus('error')
      throw new Error('Add a title to save this whiteboard.')
    }
    setStatus('saving')
    const data = dataRef.current
    const renamed = nextTitle !== synced.current.title
    // Our own change: this view updates its cache below, so the echo needn't refetch it.
    const saved = ownSave('diagrams', diagram.id)
    try {
      saved(await updateDiagram(diagram.id, { title: nextTitle, data }))
    } catch (error) {
      saved()
      setStatus('error')
      throw error
    }
    savedVersion.current = target
    synced.current = { title: nextTitle, data }
    // A refetch that started before this save still carries the old diagram: drop it.
    void queryClient.cancelQueries({ queryKey: diagramQuery(diagram.id).queryKey, exact: true })
    queryClient.setQueryData(diagramQuery(diagram.id).queryKey, (old) =>
      old ? { ...old, title: nextTitle, data, updated_at: new Date().toISOString() } : old,
    )
    // Lists show the title, not the canvas: only a rename needs them asked for again.
    if (renamed) {
      void queryClient.invalidateQueries({ queryKey: ['diagrams', 'team'] })
      void queryClient.invalidateQueries({ queryKey: ['diagrams', 'workspace'] })
    }
    setStatus(version.current === target ? 'saved' : 'pending')
  }, [diagram.id, queryClient])

  /** Save now (after any save already running). Rejects if it fails. */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const run = inflight.current.catch(() => {}).then(save)
    inflight.current = run
    return run
  }, [save])

  const { lockedBy, markTyping } = useOthersTyping(`diagram:${diagram.id}`, canWrite)
  // Someone else has the canvas: read-only until they stop (see useOthersTyping).
  const locked = lockedBy.length > 0
  const markChanged = useCallback(() => {
    version.current += 1
    markTyping()
    setStatus('pending')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      flush().catch((error: unknown) => toast.error(errorMessage(error), { id: 'diagram-save' }))
    }, AUTOSAVE_MS)
  }, [flush, markTyping])

  const onChange = useCallback(
    (data: Json) => {
      if (!canWrite) return
      dataRef.current = data
      markChanged()
    },
    [canWrite, markChanged],
  )

  // Unmounting with unsaved edits (a lesson's tabs switch without changing the page): save them now.
  useEffect(
    () => () => {
      if (version.current !== savedVersion.current) flush().catch((error: unknown) => toast.error(errorMessage(error), { id: 'diagram-save' }))
      else window.clearTimeout(timer.current)
    },
    [flush],
  )

  // A diagram that changed on the server (someone else, another tab) replaces
  // what's shown here, unless there are unsaved edits.
  useEffect(() => {
    if (version.current !== savedVersion.current) return
    const sameData = sameJson(diagram.data, synced.current.data)
    if (sameData && diagram.title === synced.current.title) return
    // Already on the canvas (our own save coming back): leave the editor alone.
    const shown = sameData || sameJson(diagram.data, dataRef.current)
    synced.current = { title: diagram.title, data: diagram.data }
    titleRef.current = diagram.title
    dataRef.current = diagram.data
    setTitle(diagram.title)
    if (!shown) setInitial(parse(diagram.data))
  }, [diagram.title, diagram.data])

  useEffect(() => {
    if (!canWrite) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key ?? '').toLowerCase() === 's') {
        event.preventDefault()
        flush().catch((error: unknown) => toast.error(errorMessage(error), { id: 'diagram-save' }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canWrite, flush])

  // ---------------------------------------------------- leaving the page
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      canWrite &&
      !leaving.current &&
      version.current !== savedVersion.current &&
      currentLocation.pathname !== nextLocation.pathname,
  )
  const [saveFailedOnLeave, setSaveFailedOnLeave] = useState(false)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    flush()
      .then(() => blocker.proceed())
      .catch(() => setSaveFailedOnLeave(true))
  }, [blocker, flush])

  useEffect(() => {
    if (status === 'saved') return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  // --------------------------------------------------------------- delete
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const remove = async () => {
    setDeleting(true)
    try {
      window.clearTimeout(timer.current)
      ownWrite('diagrams', diagram.id, 15_000)
      await deleteDiagram(diagram.id)
      // Nothing left to save: leaving mustn't try to save a deleted whiteboard.
      savedVersion.current = version.current
      toast.success(`${diagram.title} was deleted`)
      // Leave the page before dropping its data (see useExitTeam for why).
      leaving.current = true
      await navigate(backTo, { replace: true, state: filesState ?? undefined })
      queryClient.removeQueries({ queryKey: ['diagrams', diagram.id] })
      // Only the lists showed it.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['diagrams', 'team'] }),
        queryClient.invalidateQueries({ queryKey: ['diagrams', 'workspace'] }),
      ])
    } catch (error) {
      toast.error(errorMessage(error))
      setDeleting(false)
    }
  }

  // ------------------------------------------------------- full screen
  // The page is full-bleed (route handle): a slim header, then the editor fills the rest of the
  // window. Full screen goes one step further and covers the app's sidebar and top bar too.
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Escape' && !target?.closest('input, textarea, [contenteditable]')) setFullscreen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullscreen])

  return (
    <div className={cn('flex flex-col', embedded ? 'h-full' : 'h-[calc(100svh-3rem)]')}>
      {embedded ? (
        <div className="flex h-8 shrink-0 items-center justify-end gap-2 border-b px-3 text-xs text-muted-foreground">
          {canWrite ? <SaveIndicator status={status} /> : <span className="rounded-sm border px-1.5 py-0.5">View only</span>}
        </div>
      ) : (
      /* One slim row: back to Files (and the folder) · title · where and when · saved · delete. */
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3 md:px-4">
        <nav aria-label="Folder path" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Link to={filesState?.filesReturnTo ?? listPath} state={filesState ?? undefined} className="inline-flex items-center gap-1 rounded-sm hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Files
          </Link>
          {path.map((folder) => (
            <span key={folder.id} className="hidden items-center gap-1 sm:flex">
              <ChevronRight className="size-3 shrink-0" />
              <Link to={folderLink(folder.id)} className="max-w-28 truncate hover:text-foreground">
                {folder.name}
              </Link>
            </span>
          ))}
        </nav>
        <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
        {canWrite ? (
          <input
            value={title}
            maxLength={200}
            aria-label="Title"
            readOnly={locked}
            placeholder="Untitled whiteboard"
            onChange={(e) => {
              setTitle(e.target.value)
              titleRef.current = e.target.value
              markChanged()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 text-sm font-semibold outline-none placeholder:text-muted-foreground/50 hover:bg-muted/50 focus:bg-muted/50"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{diagram.title}</h1>
        )}
        <div className="hidden min-w-0 shrink items-center gap-2 text-xs text-muted-foreground lg:flex">
          {/* In a workspace the scope is in the breadcrumb above. */}
          {!workspaceId && <DocScope doc={diagram} />}
          <span className="truncate">
            {diagram.author?.display_name ?? 'Former member'} · Updated {timeSince(diagram.updated_at, now)}
          </span>
          {!canWrite && <span className="shrink-0 rounded-sm border px-1.5 py-0.5">View only</span>}
        </div>
        <ShareButton kind="diagram" item={diagram} />
        {canWrite && (
          <div className="flex shrink-0 items-center gap-1">
            <SaveIndicator status={status} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete whiteboard"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </header>
      )}

      {lockedBy.length > 0 && (
        <div className="shrink-0 border-b px-3 py-2 md:px-4">
          <OthersTypingAlert names={lockedBy} />
        </div>
      )}
      <div className={cn('bg-background', fullscreen ? 'fixed inset-0 z-50' : 'min-h-0 flex-1')}>
        <DiagramEditor
          initial={initial}
          readOnly={!canWrite || locked}
          onChange={onChange}
          fullscreen={fullscreen}
          onFullscreen={setFullscreen}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${diagram.title}?`}
        description="This can’t be undone."
        confirmLabel="Delete whiteboard"
        pending={deleting}
        onConfirm={() => void remove()}
      />
      <ConfirmDialog
        open={saveFailedOnLeave}
        onOpenChange={(open) => {
          if (open) return
          setSaveFailedOnLeave(false)
          if (blocker.state === 'blocked') blocker.reset()
        }}
        title="Couldn’t save your latest changes"
        description="If you leave now, your most recent edits will be lost."
        confirmLabel="Leave anyway"
        onConfirm={() => {
          setSaveFailedOnLeave(false)
          if (blocker.state === 'blocked') blocker.proceed()
        }}
      />
    </div>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const label = { saved: 'Saved', pending: 'Editing…', saving: 'Saving…', error: 'Not saved' }[status]
  return (
    <span
      aria-live="polite"
      className={cn('text-xs', status === 'error' ? 'text-destructive' : 'text-muted-foreground')}
    >
      {label}
    </span>
  )
}
