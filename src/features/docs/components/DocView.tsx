import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { ArrowLeft, ChevronRight, GripVertical, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { OthersTypingAlert } from '@/components/OthersTypingAlert'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { useCurrentTeam } from '@/features/teams/hooks'
import { ownSave, ownWrite } from '@/lib/realtime'
import { useOthersTyping } from '@/hooks/use-others-typing'
import { docsPath } from '@/features/teams/nav'
import type { Json } from '@/types/database.types'
import { errorMessage } from '@/lib/errors'
import { sameJson } from '@/lib/json'
import { timeSince } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  deleteDocument,
  documentQuery,
  foldersQuery,
  IMAGE_TYPES,
  updateDocument,
  uploadDocImage,
  type Doc,
} from '../api'
import { adoptContent } from '../editor/adopt'
import { docExtensions } from '../editor/extensions'
import { folderPath } from '../folders'
import { readFilesLocationState } from '../files-navigation'
import { FormatBubble } from '../editor/FormatBubble'
import { FileLinkPicker } from '../editor/FileLinkPicker'
import { InsertMenu } from '../editor/InsertMenu'
import { docContentClass } from '../editor/styles'
import { DocScope } from './DocScope'
import { ShareButton } from './ShareButton'

const AUTOSAVE_MS = 800

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

/** A stored body we can hand to TipTap (anything else starts empty). */
function initialContent(body: Json | null): JSONContent | null {
  if (body && typeof body === 'object' && !Array.isArray(body) && body.type === 'doc') return body as JSONContent
  return null
}

/**
 * The doc page body (lazy-loaded with the editor): Paper-style title + rich
 * editor for anyone who can edit, the same rendering read-only for everyone else.
 * Edits autosave; leaving flushes the save first. `embedded` (a lesson's text) leaves out the page's
 * frame (the Files path, author and delete, and the title unless `withTitle`): the page around it has its own.
 */
export default function DocView({
  doc,
  canEdit,
  canDelete,
  embedded = false,
  withTitle = false,
}: {
  doc: Doc
  canEdit: boolean
  canDelete: boolean
  embedded?: boolean
  /** Embedded only: show the doc's own title above it (a lesson's extra docs; its Lesson doc has none). */
  withTitle?: boolean
}) {
  const { workspaceId } = useParams()
  const { team } = useCurrentTeam()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [now] = useState(Date.now)
  const listPath = docsPath(team.slug, workspaceId)
  const folderLink = (folderId: string | null) => (folderId ? `${listPath}?folder=${folderId}` : listPath)
  const filesState = readFilesLocationState(location.state, listPath)
  const backTo = filesState?.filesReturnTo ?? folderLink(doc.folder_id)

  // ------------------------------------------------------------ autosave
  const [title, setTitle] = useState(doc.title)
  // The title wraps like Paper's, so it's a textarea. Size it to its content here:
  // CSS field-sizing isn't supported in Safari/Firefox, where it would scroll.
  const titleField = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = titleField.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [title])
  const [status, setStatus] = useState<SaveStatus>('saved')
  const titleRef = useRef(doc.title)
  const version = useRef(0) // bumped on every edit
  const savedVersion = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  const leaving = useRef(false)
  const editorRef = useRef<Editor | null>(null)
  // What the server has, as far as this view knows (the last load, save, or adopted change).
  const synced = useRef({ title: doc.title, body: doc.body })

  const save = useCallback(async () => {
    const editor = editorRef.current
    const target = version.current
    if (!editor || target === savedVersion.current) return
    const nextTitle = titleRef.current.trim()
    if (!nextTitle) {
      setStatus('error')
      throw new Error('Add a title to save this doc.')
    }
    setStatus('saving')
    const body = editor.getJSON() as Json
    const content = editor.getText({ blockSeparator: '\n' })
    const renamed = nextTitle !== synced.current.title
    // Our own change: this view updates its cache below, so the echo needn't refetch it.
    const saved = ownSave('documents', doc.id)
    let updatedAt: string | undefined
    try {
      updatedAt = await updateDocument(doc.id, { title: nextTitle, body, content })
      saved(updatedAt)
    } catch (error) {
      saved()
      setStatus('error')
      throw error
    }
    const savedAt = updatedAt ?? new Date().toISOString()
    savedVersion.current = target
    synced.current = { title: nextTitle, body }
    // A refetch that started before this save still carries the old body: drop it.
    void queryClient.cancelQueries({ queryKey: documentQuery(doc.id).queryKey, exact: true })
    // Keep the cached doc in sync without refetching the (possibly large) body.
    queryClient.setQueryData(documentQuery(doc.id).queryKey, (old) =>
      old ? { ...old, title: nextTitle, body, content, updated_at: savedAt } : old,
    )
    // Lists show the title, not the text: only a rename needs them asked for again.
    if (renamed) {
      void queryClient.invalidateQueries({ queryKey: ['documents', 'team'] })
      void queryClient.invalidateQueries({ queryKey: ['documents', 'workspace'] })
    }
    setStatus(version.current === target ? 'saved' : 'pending')
  }, [doc.id, queryClient])

  /** Save now (after any save already running). Rejects if it fails. */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const run = inflight.current.catch(() => {}).then(save)
    inflight.current = run
    return run
  }, [save])

  const { lockedBy, markTyping } = useOthersTyping(`doc:${doc.id}`, canEdit)
  const markChanged = useCallback(() => {
    version.current += 1
    markTyping()
    setStatus('pending')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      flush().catch((error: unknown) => toast.error(errorMessage(error), { id: 'doc-save' }))
    }, AUTOSAVE_MS)
  }, [flush, markTyping])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // --------------------------------------------------------------- images
  const fileInput = useRef<HTMLInputElement>(null)
  const insertImages = useCallback(
    async (editor: Editor, files: File[], pos?: number) => {
      for (const file of files) {
        const toastId = toast.loading('Uploading image…')
        try {
          const path = await uploadDocImage(team.id, doc.id, file)
          editor.chain().focus().insertDocImage({ path, alt: file.name }, pos).run()
          toast.dismiss(toastId)
        } catch (error) {
          toast.error(errorMessage(error), { id: toastId })
        }
      }
    },
    [team.id, doc.id],
  )

  // --------------------------------------------------------------- editor
  // Stable for the life of this view (DocView is keyed by doc id), so the editor is built once.
  const extensions = useMemo(
    () =>
      docExtensions({
        editable: canEdit,
        onImageFiles: (editor, files, pos) => void insertImages(editor, files, pos),
      }),
    [canEdit, insertImages],
  )
  const editor = useEditor({
    extensions,
    content: initialContent(doc.body),
    editable: canEdit,
    immediatelyRender: true,
    editorProps: { attributes: { class: docContentClass, 'aria-label': 'Document content' } },
    onUpdate: () => markChanged(),
  })
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Someone else has the text: read-only until they stop (see useOthersTyping). Not reported as an edit.
  const locked = lockedBy.length > 0
  useEffect(() => {
    editor?.setEditable(canEdit && !locked, false)
  }, [editor, locked, canEdit])

  // A doc that changed on the server (someone else, another tab) replaces what's
  // shown here, unless there are unsaved edits.
  useEffect(() => {
    if (version.current !== savedVersion.current) return
    const sameBody = sameJson(doc.body, synced.current.body)
    if (sameBody && doc.title === synced.current.title) return
    synced.current = { title: doc.title, body: doc.body }
    titleRef.current = doc.title
    setTitle(doc.title)
    if (!sameBody && editor) adoptContent(editor, doc.body)
  }, [doc.title, doc.body, editor])

  // ---------------------------------------------------- leaving the page
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      canEdit &&
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
      ownWrite('documents', doc.id, 15_000)
      await deleteDocument(team.id, doc.id)
      toast.success(`${doc.title} was deleted`)
      // Leave the page before dropping its data (see useExitTeam for why).
      leaving.current = true
      await navigate(backTo, { replace: true, state: filesState ?? undefined })
      queryClient.removeQueries({ queryKey: ['documents', doc.id] })
      // Only the lists showed it.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents', 'team'] }),
        queryClient.invalidateQueries({ queryKey: ['documents', 'workspace'] }),
      ])
    } catch (error) {
      toast.error(errorMessage(error))
      setDeleting(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && (event.key ?? '').toLowerCase() === 's') {
      event.preventDefault()
      if (canEdit) flush().catch((error: unknown) => toast.error(errorMessage(error), { id: 'doc-save' }))
    }
  }

  // The title: editable for editors (it wraps like Paper's), a heading for everyone else.
  const titleInput = (
    <>
        {canEdit ? (
          <textarea
            ref={titleField}
            value={title}
            rows={1}
            maxLength={200}
            aria-label="Title"
            placeholder="Untitled"
            readOnly={locked}
            onChange={(e) => {
              const next = e.target.value.replace(/\n/g, ' ')
              setTitle(next)
              titleRef.current = next
              markChanged()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                editor?.commands.focus('start')
              }
            }}
            className="block w-full resize-none overflow-hidden bg-transparent text-[2.25rem] leading-[1.15] font-bold tracking-tight outline-none placeholder:text-muted-foreground/50 md:text-[2.75rem]"
          />
        ) : (
          <h1 className="text-[2.25rem] leading-[1.15] font-bold tracking-tight md:text-[2.75rem]">{doc.title}</h1>
        )}
    </>
  )

  // Leaving with a save that failed: asks before the edits are dropped (both layouts).
  const saveFailedDialog = (
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
  )

  if (embedded) {
    return (
      // The left gutter holds the drag handle and the heading collapse toggles.
      <div className="-ml-8 pl-8" onKeyDown={onKeyDown}>
        {canEdit && (
          <div className="flex justify-end">
            <SaveIndicator status={status} />
          </div>
        )}
        {withTitle && <div className="mb-6">{titleInput}</div>}
        {editor && canEdit && (
          <>
            <FormatBubble editor={editor} />
            <InsertMenu editor={editor} onPickImage={() => fileInput.current?.click()} />
            <FileLinkPicker editor={editor} excludeId={doc.id} />
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (files.length) void insertImages(editor, files)
              }}
            />
          </>
        )}
        <OthersTypingAlert names={lockedBy} />
        <EditorContent editor={editor} className="pb-8" />
        {saveFailedDialog}
      </div>
    )
  }

  return (
    // Left gutter holds the drag handle and the heading collapse toggles.
    <div className="pl-6 md:pl-16" onKeyDown={onKeyDown}>
      <div className="mb-8 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          <FolderPathNav doc={doc} listPath={listPath} folderLink={folderLink} filesState={filesState} />
          {/* In a workspace the scope is obvious from the tabs above. */}
          {!workspaceId && (
            <>
              <span aria-hidden>·</span>
              <DocScope doc={doc} />
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit && <SaveIndicator status={status} />}
          <ShareButton kind="doc" item={doc} />
        {canEdit && (
          <>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete doc"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
              </Button>
            )}
          </>
        )}
        </div>
      </div>

      {titleInput}

      <p className="mt-3 mb-10 flex items-center gap-2 text-xs text-muted-foreground">
        <PersonAvatar profile={doc.author} className="size-5" />
        <span>{doc.author?.display_name ?? 'Former member'}</span>
        <span aria-hidden>·</span>
        <span>Updated {timeSince(doc.updated_at, now)}</span>
        {!canEdit && (
          <>
            <span aria-hidden>·</span>
            <span>View only</span>
          </>
        )}
      </p>

      {editor && canEdit && (
        <>
          <FormatBubble editor={editor} />
          <InsertMenu editor={editor} onPickImage={() => fileInput.current?.click()} />
          <FileLinkPicker editor={editor} excludeId={doc.id} />
          <DragHandle editor={editor} className="pointer-events-none! hidden md:block">
            {/* mr-7 keeps the grip clear of the heading collapse toggle (like Paper: ⠿ then ▾);
                the wrapper is click-through (important: the plugin sets pointer-events inline). */}
            <div
              className="pointer-events-auto mr-7 flex h-6 w-5 cursor-grab items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
              aria-label="Drag to move block"
            >
              <GripVertical className="size-4" />
            </div>
          </DragHandle>
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length) void insertImages(editor, files)
            }}
          />
        </>
      )}
      <OthersTypingAlert names={lockedBy} />
      <EditorContent editor={editor} className="pb-[30vh]" />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${doc.title}?`}
        description="This can’t be undone. Images in it are deleted too."
        confirmLabel="Delete doc"
        pending={deleting}
        onConfirm={() => void remove()}
      />
      {saveFailedDialog}
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

/** "← Files › Week 1 › Notes": the doc's folders (fetched here, so an embedded doc doesn't ask for them). */
function FolderPathNav({
  doc,
  listPath,
  folderLink,
  filesState,
}: {
  doc: Doc
  listPath: string
  folderLink: (folderId: string | null) => string
  filesState: ReturnType<typeof readFilesLocationState>
}) {
  const folders = useSuspenseQuery(foldersQuery(doc.team_id, doc.workspace_id)).data
  return (
    <nav aria-label="Folder path" className="flex min-w-0 items-center gap-1">
      <Link to={filesState?.filesReturnTo ?? listPath} state={filesState ?? undefined} className="inline-flex shrink-0 items-center gap-1 hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Files
      </Link>
      {folderPath(doc.folder_id, folders).map((folder) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0" />
          <Link to={folderLink(folder.id)} className="max-w-32 truncate hover:text-foreground">
            {folder.name}
          </Link>
        </span>
      ))}
    </nav>
  )
}
