import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, ChevronRight, FileText, Plus, Presentation } from 'lucide-react'
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { DockSpinner } from '@/components/DockSpinner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { createDiagram, diagramQuery } from '@/features/diagrams/api'
import { createDocument, documentQuery } from '@/features/docs/api'
import DocView from '@/features/docs/components/DocView'
import { useCurrentTeam } from '@/features/teams/hooks'
import { learningPath, lessonPath } from '@/features/teams/nav'
import { AUTOSAVE_MS, useSaveOnExit } from '@/hooks/use-save-on-exit'
import { errorMessage } from '@/lib/errors'
import { preloadable } from '@/lib/preloadable'
import { ownWrite } from '@/lib/realtime'
import { cn } from '@/lib/utils'
import { learningKeys, renameLesson, startLessonWhiteboard, type Lesson } from '../api'
import { useLearning, useToggleDone } from '../hooks'

// Whiteboards bring React Flow: it loads when one is opened (or its tab hovered), never with the lesson.
const board = preloadable(() => import('./LessonBoard'))
const LessonBoard = board.Component

/** Which tab is open: the lesson's text, its whiteboard, or another file in its folder (by id). */
type Tab = { kind: 'lesson' } | { kind: 'whiteboard' } | { kind: 'file'; id: string }

/**
 * A lesson (owner's choice, 2026-10-27: lessons keep their content in their folder in the course's
 * Files, and this page is how students reach it). Tabs: Lesson (its doc, edited in place by teachers),
 * Whiteboard, then any other doc or whiteboard teachers added to its folder (+). Then "Mark as done"
 * and previous/next lesson in reading order.
 */
export default function LessonView({ lesson }: { lesson: Lesson }) {
  const { team } = useCurrentTeam()
  const { workspace, outline, ordered, done, canManage } = useLearning()
  const toggle = useToggleDone()
  const queryClient = useQueryClient()
  const module = outline.find((m) => m.id === lesson.module_id)
  const moduleIndex = outline.findIndex((m) => m.id === lesson.module_id)
  const lessonIndex = module?.lessons.findIndex((l) => l.id === lesson.id) ?? -1
  const position = ordered.findIndex((l) => l.id === lesson.id)
  const previous = ordered[position - 1]
  const next = ordered[position + 1]
  const isDone = done.has(lesson.id)

  // ------------------------------------------------------------ tabs (in the URL, so a link can open one)
  const [params, setParams] = useSearchParams()
  const fileId = params.get('file')
  const tab: Tab =
    params.get('tab') === 'whiteboard'
      ? { kind: 'whiteboard' }
      : fileId && lesson.files.some((f) => f.id === fileId)
        ? { kind: 'file', id: fileId }
        : { kind: 'lesson' }
  const open = (to: Tab) =>
    setParams(
      (current) => {
        const p = new URLSearchParams(current)
        p.delete('tab')
        p.delete('file')
        if (to.kind === 'whiteboard') p.set('tab', 'whiteboard')
        if (to.kind === 'file') p.set('file', to.id)
        return p
      },
      { replace: true },
    )
  // Docs stay mounted (hidden) once opened, so switching tabs never drops an edit in the autosave wait.
  const [openedDocs, setOpenedDocs] = useState<string[]>([])
  const openDoc = tab.kind === 'file' && lesson.files.find((f) => f.id === tab.id)?.kind === 'doc' ? tab.id : null
  if (openDoc && !openedDocs.includes(openDoc)) setOpenedDocs([...openedDocs, openDoc])
  const prefetchBoard = (id: string | null) => {
    void board.preload()
    if (id) void queryClient.prefetchQuery(diagramQuery(id))
  }

  const start = useMutation({
    mutationFn: () => startLessonWhiteboard(lesson.id),
    onSuccess: (id) => {
      ownWrite('diagrams', id)
      queryClient.setQueryData<Lesson | null>(learningKeys.lesson(lesson.id), (old) => (old ? { ...old, whiteboard_id: id } : old))
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const create = useMutation({
    mutationFn: async (kind: 'doc' | 'diagram') => {
      const input = { teamId: team.id, workspaceId: workspace.id, folderId: lesson.folder_id, title: kind === 'doc' ? 'Untitled doc' : 'Untitled whiteboard' }
      return kind === 'doc' ? createDocument(input) : createDiagram(input)
    },
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: learningKeys.lesson(lesson.id), exact: true })
      open({ kind: 'file', id })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  // ------------------------------------------------------------ the title (its folder is renamed with it)
  const [title, setTitle] = useState(lesson.title)
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
  const pending = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const saveTitle = async () => {
    window.clearTimeout(timer.current)
    const value = pending.current
    if (value === null) return
    pending.current = null
    setStatus('saving')
    try {
      await renameLesson(lesson.id, value)
      queryClient.setQueryData<Lesson | null>(learningKeys.lesson(lesson.id), (old) => (old ? { ...old, title: value.trim() } : old))
      void queryClient.invalidateQueries({ queryKey: learningKeys.lessons(workspace.id) })
      setStatus(pending.current === null ? 'saved' : 'pending')
    } catch (error) {
      pending.current ??= value
      setStatus('error')
      toast.error(errorMessage(error), { id: 'lesson-save' })
    }
  }
  const saveRef = useRef(saveTitle)
  useEffect(() => {
    saveRef.current = saveTitle
  })
  // Leaving the lesson (or the tab closing) sends an unsaved title.
  useEffect(() => () => void saveRef.current(), [])
  useSaveOnExit(() => pending.current !== null, () => void saveRef.current())
  // Renamed elsewhere (another teacher, another tab): show it, unless this one is mid-edit.
  const [shownTitle, setShownTitle] = useState(lesson.title)
  if (lesson.title !== shownTitle) {
    setShownTitle(lesson.title)
    if (pending.current === null) setTitle(lesson.title)
  }
  const titleField = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = titleField.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  const tabButton = (key: string, active: boolean, label: ReactNode, onClick: () => void, onIntent?: () => void) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      className={cn(
        'inline-flex max-w-48 shrink-0 items-center gap-1.5 border-b-2 pb-2 text-sm transition-colors',
        active ? 'border-brand font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <nav aria-label="Lesson path" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Link to={learningPath(team.slug, workspace.id)} className="inline-flex shrink-0 items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Learning
          </Link>
          {module && (
            <>
              <ChevronRight className="size-3 shrink-0" />
              <span className="truncate">
                {moduleIndex + 1}. {module.title}
              </span>
              <ChevronRight className="size-3 shrink-0" />
              <span className="shrink-0 font-mono">
                {moduleIndex + 1}.{lessonIndex + 1}
              </span>
            </>
          )}
        </nav>
        {canManage && status !== 'saved' && (
          <span aria-live="polite" className={cn('text-xs', status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {{ pending: 'Editing…', saving: 'Saving…', error: 'Title not saved' }[status]}
          </span>
        )}
      </div>

      {canManage ? (
        <textarea
          ref={titleField}
          value={title}
          rows={1}
          maxLength={200}
          aria-label="Lesson title"
          placeholder="Lesson title"
          onChange={(e) => {
            const value = e.target.value.replace(/\n/g, ' ')
            setTitle(value)
            if (!value.trim()) return
            pending.current = value
            setStatus('pending')
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => void saveRef.current(), AUTOSAVE_MS)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          className="mb-6 block w-full resize-none overflow-hidden bg-transparent text-3xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/50"
        />
      ) : (
        <h1 className="mb-6 text-3xl leading-tight font-bold tracking-tight">{lesson.title}</h1>
      )}

      <div className="mb-6 flex items-end gap-4 border-b">
        <div role="tablist" aria-label="Lesson files" className="-mb-px flex min-w-0 gap-4 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabButton('lesson', tab.kind === 'lesson', 'Lesson', () => open({ kind: 'lesson' }))}
          {tabButton('whiteboard', tab.kind === 'whiteboard', 'Whiteboard', () => open({ kind: 'whiteboard' }), () => prefetchBoard(lesson.whiteboard_id))}
          {lesson.files.map((file) =>
            tabButton(
              file.id,
              tab.kind === 'file' && tab.id === file.id,
              <>
                {file.kind === 'doc' ? <FileText className="size-3.5 shrink-0" /> : <Presentation className="size-3.5 shrink-0" />}
                <span className="truncate">{file.title}</span>
              </>,
              () => open({ kind: 'file', id: file.id }),
              file.kind === 'diagram' ? () => prefetchBoard(file.id) : undefined,
            ),
          )}
        </div>
        {canManage && lesson.folder_id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="mb-1 shrink-0 text-muted-foreground" aria-label="Add a file to this lesson" disabled={create.isPending}>
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => create.mutate('doc')}>
                <FileText /> Doc
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => create.mutate('diagram')}>
                <Presentation /> Whiteboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* The lesson's text: hidden, not unmounted, on other tabs, so its unsaved edits stay put. */}
      <div role="tabpanel" aria-label="Lesson" hidden={tab.kind !== 'lesson'}>
        {lesson.doc_id ? (
          <LessonDoc docId={lesson.doc_id} canManage={canManage} empty="This lesson doesn’t have any content yet." />
        ) : (
          <p className="text-sm text-muted-foreground">This lesson’s text is missing.</p>
        )}
      </div>
      {openedDocs.map((id) => (
        <div key={id} role="tabpanel" aria-label={lesson.files.find((f) => f.id === id)?.title} hidden={openDoc !== id}>
          <LessonDoc docId={id} canManage={canManage} withTitle empty="This doc is empty." />
        </div>
      ))}
      {(tab.kind === 'whiteboard' || (tab.kind === 'file' && !openDoc)) && (
        <div role="tabpanel" aria-label="Whiteboard" className="h-[calc(100svh-19rem)] min-h-[28rem] overflow-hidden rounded-lg border">
          <Suspense fallback={<div className="flex h-full items-center justify-center"><DockSpinner label="Loading the whiteboard" /></div>}>
            {tab.kind === 'whiteboard' ? (
              <LessonBoard diagramId={lesson.whiteboard_id} canManage={canManage} onStart={() => start.mutate()} starting={start.isPending} />
            ) : (
              <LessonBoard key={tab.kind === 'file' ? tab.id : ''} diagramId={tab.kind === 'file' ? tab.id : null} canManage={canManage} />
            )}
          </Suspense>
        </div>
      )}

      <div className="mt-12 flex flex-col gap-4 border-t pt-6">
        <Button
          size="lg"
          variant={isDone ? 'secondary' : 'default'}
          className="self-start"
          aria-pressed={isDone}
          onClick={() => toggle.mutate({ lessonId: lesson.id, done: !isDone })}
        >
          <Check /> {isDone ? 'Done. Mark as not done' : 'Mark as done'}
        </Button>
        <div className="grid grid-cols-2 gap-3">
          {previous ? (
            <Link
              to={lessonPath(team.slug, workspace.id, previous.id)}
              className="group rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowLeft className="size-3" /> Previous
              </span>
              <span className="mt-1 block truncate font-medium">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to={lessonPath(team.slug, workspace.id, next.id)}
              onClick={() => {
                // Finishing a lesson by moving on marks it done, like most course sites.
                if (!isDone) toggle.mutate({ lessonId: lesson.id, done: true })
              }}
              className="group rounded-lg border p-3 text-right text-sm transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                {isDone ? 'Next' : 'Done, next lesson'} <ArrowRight className="size-3" />
              </span>
              <span className="mt-1 block truncate font-medium">{next.title}</span>
            </Link>
          ) : (
            <Link
              to={learningPath(team.slug, workspace.id)}
              className="rounded-lg border p-3 text-right text-sm transition-colors hover:bg-muted/50"
            >
              <span className="text-xs text-muted-foreground">Last lesson</span>
              <span className="mt-1 block font-medium">Back to the course</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A doc in the lesson's folder, shown in place (the Docs editor; teachers edit, the database holds
 * everyone else to viewing). The Lesson doc comes with the lesson (lessonLoader caches it); others
 * load when their tab opens.
 */
function LessonDoc({ docId, canManage, withTitle = false, empty }: { docId: string; canManage: boolean; withTitle?: boolean; empty: string }) {
  const doc = useQuery(documentQuery(docId))
  if (doc.isPending) return <TextSkeleton />
  if (doc.isError) return <p className="text-sm text-muted-foreground">Couldn’t load this.</p>
  if (!doc.data) return <p className="text-sm text-muted-foreground">This doc was deleted.</p>
  const canEdit = canManage && doc.data.access_level >= 2
  // Readers of an empty doc see a line instead of a blank page (a doc of only images still has a body).
  if (!canEdit && !doc.data.content.trim() && !JSON.stringify(doc.data.body ?? null).includes('docImage')) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return <DocView key={doc.data.id} doc={doc.data} canEdit={canEdit} canDelete={false} embedded withTitle={withTitle} />
}

function TextSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  )
}
