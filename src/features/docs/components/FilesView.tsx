import { useQuery, useQueryClient, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, Clock, FileText, Folder, Globe, Layers, Plus, Search, Presentation, X, type LucideIcon } from 'lucide-react'
import { Suspense, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCollectionView } from '@/features/collections/hooks'
import { teamDiagramsQuery, type DiagramSummary } from '@/features/diagrams/api'
import { CreateDiagramDialog } from '@/features/diagrams/components/CreateDiagramDialog'
import { useCurrentTeam } from '@/features/teams/hooks'
import { diagramPath, docPath, hasFiles } from '@/features/teams/nav'
import { workspaceTypes } from '@/features/teams/permissions'
import type { WorkspaceModule, WorkspaceType } from '@/features/workspaces/api'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { foldersQuery, teamDocsQuery, type DocFolder, type DocSummary } from '../api'
import { folderPath } from '../folders'
import { readFilesLocationState } from '../files-navigation'
import { useCanEditDocs, useCanWriteDocs } from '../hooks'
import { CreateDocDialog } from './CreateDocDialog'
import { DocBrowser } from './DocBrowser'
import { DocScope } from './DocScope'
import { useAuth } from '@/features/auth/hooks'
import { FileRowActions } from './FileRowActions'
import { RestrictedMark } from './RestrictedMark'
import { FILE_HEADER, FILE_ROW } from './fileGrid'

/** What the chips choose (`?view=`; the Folders chip is 'files' in code and is the default). */
type View = 'recent' | 'files' | 'docs' | 'diagrams'
const VIEWS: View[] = ['recent', 'files', 'docs', 'diagrams']
/** The place dropdown (`?in=`): everywhere (lists only), the group's own, or one workspace. */
const EVERYWHERE = 'everywhere'
const GROUP = 'group'
const RECENT_LIMIT = 25

type Space = { id: string; title: string; type: WorkspaceType; modules: WorkspaceModule[] }
type Row = { kind: 'doc'; item: DocSummary } | { kind: 'diagram'; item: DiagramSummary }

/**
 * Files (the UI name; URLs say docs), on the group page and in a workspace's Files tab. The chips
 * choose what to see: Recent (newest of both), Folders (one place's folders, then what isn't in a
 * folder; inside one, its contents), Docs or Diagrams (flat lists that say which folder each is in). The place is a
 * dropdown the group page puts at the right of its header (`header`; a workspace's tab is its own place). Everything
 * reads the group's doc and diagram lists (shared with links and kept live), plus the folders of
 * the place in view.
 */
export function FilesView({
  workspace,
  aside,
  header,
}: {
  workspace?: Space
  /** On the chips row, at the right (a workspace's link to the group's files). */
  aside?: ReactNode
  /** The page header, given the place dropdown to show at its right (group page only). */
  header?: (placeControl: ReactNode) => ReactNode
}) {
  const { team } = useCurrentTeam()
  const [{ data: docs }, { data: diagrams }] = useSuspenseQueries({ queries: [teamDocsQuery(team.id), teamDiagramsQuery(team.id)] })
  const canWrite = useCanWriteDocs()
  const canEdit = useCanEditDocs()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const filesReturnTo = `${location.pathname}${location.search}`
  const filesState = readFilesLocationState(location.state, location.pathname)
  const { workspaces, inView } = useCollectionView()
  const spaces: Space[] = workspace ? [workspace] : workspaces.filter((w) => hasFiles(w.modules)).sort((a, b) => a.title.localeCompare(b.title))

  const requestedView = params.get('view') as View | null
  const view: View = requestedView && VIEWS.includes(requestedView) ? requestedView : 'files'
  const requestedPlace = params.get('in')
  let place = workspace
    ? workspace.id
    : requestedPlace === EVERYWHERE || requestedPlace === GROUP || spaces.some((w) => w.id === requestedPlace)
      ? (requestedPlace as string)
      : view === 'files'
        ? GROUP
        : EVERYWHERE
  // Folders belong to one place, so Files needs one.
  if (view === 'files' && place === EVERYWHERE) place = GROUP
  const space = spaces.find((w) => w.id === place) ?? null
  /** The workspace id of the place (null = the group's own); undefined for everywhere. */
  const placeWorkspace = place === EVERYWHERE ? undefined : (space?.id ?? null)

  const enabled = (workspaceId: string | null, tool: 'docs' | 'diagrams') =>
    workspaceId === null || (spaces.find((w) => w.id === workspaceId)?.modules.includes(tool) ?? false)
  const inPlace = (workspaceId: string | null) =>
    place === EVERYWHERE ? inView(workspaceId) && (workspaceId === null || spaces.some((w) => w.id === workspaceId)) : workspaceId === placeWorkspace
  // A lesson's files are reached through its lesson page; only the course's managers see them here.
  const shown = (item: DocSummary) => item.lesson_id === null || canWrite(item.workspace_id)
  const placeDocs = docs.filter((d) => inPlace(d.workspace_id) && enabled(d.workspace_id, 'docs') && shown(d))
  const placeDiagrams = diagrams.filter((d) => inPlace(d.workspace_id) && enabled(d.workspace_id, 'diagrams') && shown(d))
  const docsOn = workspace ? workspace.modules.includes('docs') : true
  const diagramsOn = workspace ? workspace.modules.includes('diagrams') : true

  const hrefFor = (kind: 'doc' | 'diagram', item: { id: string; workspace_id: string | null }) => {
    const inWorkspace = workspace && item.workspace_id === workspace.id ? workspace.id : undefined
    return kind === 'doc' ? docPath(team.slug, item.id, inWorkspace) : diagramPath(team.slug, item.id, inWorkspace)
  }
  const go = (next: { view?: View; place?: string }) =>
    setParams(() => {
      const p = new URLSearchParams()
      const v = next.view ?? view
      const wanted = next.place ?? place
      // Files needs one place: from Everywhere it opens the group's own folders.
      const at = v === 'files' && wanted === EVERYWHERE ? GROUP : wanted
      if (v !== 'files') p.set('view', v)
      if (!workspace && at !== (v === 'files' ? GROUP : EVERYWHERE)) p.set('in', at)
      return p
    })

  // Who may make what in the place. Everywhere: the dialog asks where, among the places you may write.
  const writeAnywhere = canWrite(null) || spaces.some((w) => canWrite(w.id))
  const editAnywhere = canEdit(null) || spaces.some((w) => canEdit(w.id))
  const canNewDoc = placeWorkspace === undefined ? editAnywhere : enabled(placeWorkspace, 'docs') && canEdit(placeWorkspace)
  const canNewDiagram = placeWorkspace === undefined ? writeAnywhere : enabled(placeWorkspace, 'diagrams') && canWrite(placeWorkspace)

  const chips: { id: View; label: string; icon: LucideIcon; count?: number }[] = [
    { id: 'recent', label: 'Recent', icon: Clock },
    { id: 'files', label: 'Folders', icon: Folder },
    ...(docsOn ? [{ id: 'docs' as const, label: 'Docs', icon: FileText, count: placeDocs.length }] : []),
    ...(diagramsOn ? [{ id: 'diagrams' as const, label: 'Whiteboards', icon: Presentation, count: placeDiagrams.length }] : []),
  ]

  const placeControl = workspace ? undefined : (
    <PlaceSelect
      value={place}
      allowEverywhere={view !== 'files'}
      spaces={spaces}
      onChange={(next) => go({ place: next })}
      onHover={(id) => void queryClient.prefetchQuery(foldersQuery(team.id, id))}
    />
  )

  return (
    <>
      {header?.(placeControl)}
      <div className="mb-4 flex items-center gap-3">
      <nav aria-label="View" className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={view === chip.id}
            onClick={() => go({ view: chip.id })}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              view === chip.id
                ? 'border-foreground/15 bg-muted font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <chip.icon className={cn('size-3.5', view === chip.id && 'text-brand')} />
            {chip.label}
            {chip.count !== undefined && <span className="font-mono text-xs text-muted-foreground">{chip.count}</span>}
          </button>
        ))}
      </nav>
      {aside && <div className="shrink-0 pb-1">{aside}</div>}
      </div>

      {view === 'files' ? (
        <Suspense key={place} fallback={<RowsLoading />}>
          <PlaceFiles
            workspaceId={placeWorkspace ?? null}
            docs={docs.filter((d) => d.workspace_id === (placeWorkspace ?? null))}
            diagrams={diagrams.filter((d) => d.workspace_id === (placeWorkspace ?? null))}
            docsEnabled={enabled(placeWorkspace ?? null, 'docs')}
            diagramsEnabled={enabled(placeWorkspace ?? null, 'diagrams')}
            canWrite={canWrite(placeWorkspace ?? null)}
            canCreate={canEdit(placeWorkspace ?? null)}
            hrefFor={hrefFor}
            filesReturnTo={filesReturnTo}
            filesState={filesState}
            rootLabel={space?.title ?? 'Group-wide'}
            empty={space ? `Nothing in ${space.title} yet.` : 'Nothing group-wide yet. Create a doc, a whiteboard or a folder.'}
          />
        </Suspense>
      ) : (
        <FlatList
          view={view}
          rows={[
            ...(view !== 'diagrams' ? placeDocs.map((item) => ({ kind: 'doc' as const, item })) : []),
            ...(view !== 'docs' ? placeDiagrams.map((item) => ({ kind: 'diagram' as const, item })) : []),
          ]}
          placeWorkspace={placeWorkspace}
          hrefFor={hrefFor}
          filesReturnTo={filesReturnTo}
          filesState={filesState}
          canNewDoc={view !== 'diagrams' && canNewDoc}
          canNewDiagram={view !== 'docs' && canNewDiagram}
          canWrite={canWrite}
        />
      )}
    </>
  )
}

/** The place dropdown, at the right of the group page's header. */
function PlaceSelect({
  value,
  allowEverywhere,
  spaces,
  onChange,
  onHover,
}: {
  value: string
  allowEverywhere: boolean
  spaces: Space[]
  onChange: (place: string) => void
  onHover: (workspaceId: string) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        // Radix reports '' when the options change under it; ignore that.
        if (next) onChange(next)
      }}
    >
      <SelectTrigger size="sm" aria-label="Place" className="h-8 w-48 sm:w-56">
        <SelectValue />
      </SelectTrigger>
      {/* Below the button, like a menu (item-aligned would cover the trigger with the current choice). */}
      <SelectContent position="popper" align="end" className="min-w-56">
        {allowEverywhere && (
          <>
            <SelectItem value={EVERYWHERE}>
              <Layers className="text-muted-foreground" /> Everywhere
            </SelectItem>
            <SelectSeparator />
          </>
        )}
        <SelectItem value={GROUP}>
          <Globe className="text-muted-foreground" /> Group-wide
        </SelectItem>
        {spaces.map((w) => {
          const Icon = workspaceTypes[w.type].icon
          return (
            <SelectItem key={w.id} value={w.id} onPointerEnter={() => onHover(w.id)}>
              <Icon className="text-muted-foreground" />
              <span className="truncate">{w.title}</span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

/** The Files view: one place's folders (they load when the place is picked). */
function PlaceFiles({
  workspaceId,
  hrefFor,
  filesReturnTo,
  filesState,
  ...props
}: {
  workspaceId: string | null
  docs: DocSummary[]
  diagrams: DiagramSummary[]
  docsEnabled: boolean
  diagramsEnabled: boolean
  canWrite: boolean
  canCreate: boolean
  hrefFor: (kind: 'doc' | 'diagram', item: DocSummary) => string
  filesReturnTo: string
  filesState: ReturnType<typeof readFilesLocationState>
  rootLabel?: string
  empty: string
}) {
  const { team } = useCurrentTeam()
  const all = useSuspenseQuery(foldersQuery(team.id, workspaceId)).data
  // The Lessons folder and what's in it: only for the course's managers (students open lessons).
  const folders = props.canWrite ? all : withoutLessons(all)
  return (
    <DocBrowser
      {...props}
      teamId={team.id}
      workspaceId={workspaceId}
      folders={folders}
      diagrams={props.diagramsEnabled ? props.diagrams : []}
      docHref={(doc) => hrefFor('doc', doc)}
      diagramHref={(diagram) => hrefFor('diagram', diagram)}
      filesReturnTo={filesReturnTo}
      filesState={filesState}
    />
  )
}

/**
 * Recent, Docs and Diagrams: flat lists across the place, each row saying where it lives (its
 * folder in one place; the workspace when looking everywhere), with the ··· (Move to…, Delete)
 * for writers.
 */
function FlatList({
  view,
  rows,
  placeWorkspace,
  hrefFor,
  filesReturnTo,
  filesState,
  canNewDoc,
  canNewDiagram,
  canWrite,
}: {
  view: Exclude<View, 'files'>
  rows: Row[]
  placeWorkspace: string | null | undefined
  hrefFor: (kind: 'doc' | 'diagram', item: DocSummary) => string
  filesReturnTo: string
  filesState: ReturnType<typeof readFilesLocationState>
  canNewDoc: boolean
  canNewDiagram: boolean
  /** Who may move and delete in a place (writers); the database re-checks. */
  canWrite: (workspaceId: string | null) => boolean
}) {
  const { team } = useCurrentTeam()
  const { user } = useAuth()
  const [now] = useState(Date.now)
  const [query, setQuery] = useState(filesState?.filesSearch ?? '')
  const [sort, setSort] = useState(filesState?.filesSort ?? { by: 'updated', dir: 'desc' })
  const [creating, setCreating] = useState<'doc' | 'diagram' | null>(null)
  // In one place, rows say which folder they're in (that place's folders, usually cached already).
  const folders: DocFolder[] =
    useQuery({ ...foldersQuery(team.id, placeWorkspace ?? null), enabled: placeWorkspace !== undefined }).data ?? []
  const everywhere = placeWorkspace === undefined
  /** " · in Week 1 › Notes" for something in a folder; nothing at the top of the place. */
  const placeOf = (folderId: string | null) => {
    const path = folderPath(folderId, folders).map((f) => f.name).join(' › ')
    return path ? ` · in ${path}` : ''
  }

  const needle = query.trim().toLowerCase()
  const order = sort.dir === 'asc' ? 1 : -1
  const recent = view === 'recent'
  const shown = rows
    .filter((r) => !needle || r.item.title.toLowerCase().includes(needle))
    .sort((a, b) =>
      recent || sort.by === 'updated'
        ? (recent ? -1 : order) * a.item.updated_at.localeCompare(b.item.updated_at)
        : order * a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base' }),
    )
    .slice(0, recent ? RECENT_LIMIT : undefined)
  const noun = view === 'docs' ? 'doc' : view === 'diagrams' ? 'whiteboard' : 'file'
  const sortBy = (by: 'updated' | 'name') =>
    setSort((s) => (s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'name' ? 'asc' : 'desc' }))
  const sortIcon = (by: 'updated' | 'name') =>
    !recent && sort.by === by ? sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null
  // Created at the top of the place; everywhere, the dialog asks where.
  const createIn = { workspaceId: placeWorkspace ?? undefined, groupWide: placeWorkspace === null }

  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b">
        <p className="flex h-10 items-center font-mono text-xs text-muted-foreground">
          {needle ? `${plural(shown.length, noun)} match` : recent ? `Latest ${Math.min(rows.length, RECENT_LIMIT)}` : plural(rows.length, noun)}
        </p>
        <div className="ml-auto flex items-center gap-2 pb-1.5 sm:pb-0">
          <label className="flex h-8 w-44 items-center gap-2 rounded-md border bg-background px-2 text-sm focus-within:ring-2 focus-within:ring-brand/40 sm:w-56">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder={`Search ${noun}s`}
              aria-label="Search files"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
            {needle && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </label>
          {(canNewDoc || canNewDiagram) && (
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
          <Folder className="size-8 text-muted-foreground/40" />
          {needle ? `Nothing matches “${query.trim()}”.` : `No ${noun}s here yet.`}
        </div>
      ) : (
        <>
          <div className={FILE_HEADER}>
            <span />
            <button type="button" disabled={recent} onClick={() => sortBy('name')} className="flex items-center gap-1 justify-self-start uppercase outline-none enabled:hover:text-foreground">
              Name {sortIcon('name')}
            </button>
            <span className="hidden md:block">{everywhere ? 'Where' : 'Owner'}</span>
            <button type="button" disabled={recent} onClick={() => sortBy('updated')} className="flex items-center gap-1 justify-self-end uppercase outline-none enabled:hover:text-foreground">
              Updated {sortIcon('updated')}
            </button>
            <span className="hidden md:block" />
          </div>
          <ul>
            {shown.map(({ kind, item }) => {
              const Icon = kind === 'doc' ? FileText : Presentation
              return (
                <li key={`${kind}:${item.id}`} data-file-row="" className={FILE_ROW}>
                  <span className="flex size-7 items-center justify-center">
                    <Icon className="size-4 text-muted-foreground" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <Link
                      to={hrefFor(kind, item)}
                      state={{ filesReturnTo, filesSearch: query, filesSort: sort }}
                      className="min-w-0 truncate text-sm font-medium outline-none after:absolute after:inset-0"
                    >
                      {item.title}
                    </Link>
                    <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                      {item.access === 'restricted' && <RestrictedMark />}
                      {kind === 'doc' ? 'Doc' : 'Whiteboard'}
                      {everywhere ? ` · ${item.author?.display_name ?? 'Former member'}` : placeOf(item.folder_id)}
                    </span>
                  </span>
                  {everywhere ? (
                    <span className="hidden min-w-0 md:block">
                      <DocScope doc={item} />
                    </span>
                  ) : (
                    <span className="hidden min-w-0 items-center gap-2 md:flex">
                      <PersonAvatar profile={item.author} className="size-5" />
                      <span className="truncate text-xs text-muted-foreground">{item.author?.display_name ?? 'Former member'}</span>
                    </span>
                  )}
                  <span className="text-right font-mono text-xs text-muted-foreground">{timeAgo(item.updated_at, now)}</span>
                  <span className="hidden justify-self-end md:block">
                    {(canWrite(item.workspace_id) || item.created_by === user.id) && (
                      <FileRowActions kind={kind} item={item} folders={everywhere ? undefined : folders} canWrite={canWrite(item.workspace_id)} />
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {creating === 'doc' && (
        <CreateDocDialog workspaceId={createIn.workspaceId} groupWide={createIn.groupWide} open onOpenChange={(o) => !o && setCreating(null)} />
      )}
      {creating === 'diagram' && (
        <CreateDiagramDialog workspaceId={createIn.workspaceId} groupWide={createIn.groupWide} open onOpenChange={(o) => !o && setCreating(null)} />
      )}
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A place's folders on their way: the shape of the list, not a spinner. */
function RowsLoading() {
  return (
    <div className="border-t" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b px-3">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="ml-auto h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

/** Folders minus the Lessons folder and everything under it. */
function withoutLessons(folders: DocFolder[]) {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const inLessons = (f: DocFolder | undefined): boolean => !!f && (f.is_lessons_root || f.lesson_id !== null || inLessons(byId.get(f.parent_id ?? '')))
  return folders.filter((f) => !inLessons(f))
}
