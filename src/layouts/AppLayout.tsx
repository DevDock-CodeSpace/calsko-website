import { useQuery } from '@tanstack/react-query'
import { Fragment, type CSSProperties } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router'
import { AppSidebar } from '@/components/AppSidebar'
import { NavigationSpinner } from '@/components/NavigationSpinner'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AskDevDockButton } from '@/features/ai/components/AskDevDockButton'
import { useFeature } from '@/features/flags/hooks'
import { NotificationBell } from '@/features/messaging/components/NotificationBell'
import { NotePopups } from '@/features/reminders/components/NotePopups'
import { NotesButton } from '@/features/reminders/components/NotesButton'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { diagramQuery } from '@/features/diagrams/api'
import { liveSessionQuery } from '@/features/live/api'
import { CallDock, LiveCallProvider } from '@/features/live/call/CallDock'
import { documentQuery } from '@/features/docs/api'
import { issueQuery } from '@/features/issues/api'
import { planQuery } from '@/features/plans/api'
import { lessonQuery } from '@/features/learning/api'
import { issueIdentifier } from '@/features/issues/meta'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { getTeamNav, getWorkspaceTabs, isNavActive, teamIssuesPath, teamPath, workspacePath, type NavItem } from '@/features/teams/nav'
import { workspaceQuery } from '@/features/workspaces/api'
import { useStatusSync } from '@/features/status/useStatusSync'
import { CreateWorkspaceDialog } from '@/features/workspaces/components/CreateWorkspaceDialog'
import { useRealtimeSync } from '@/hooks/use-realtime-sync'
import { useSidebarWidth } from '@/hooks/use-sidebar-width'
import { useFullBleed } from './full-bleed'
import { PageArea } from './PageArea'

// The shadcn sidebar writes its open/collapsed state to this cookie but doesn't read it back.
const sidebarStartsOpen = () => !document.cookie.includes('sidebar_state=false')

/** Team shell: sidebar + header + page. Rendered for /t/:teamSlug/*. */
export function AppLayout() {
  useRealtimeSync()
  return (
    <LiveCallProvider>
      <AppShell />
      {/* Keeps an active call alive across navigation (docks on the session page, floats elsewhere). */}
      <CallDock />
    </LiveCallProvider>
  )
}

function AppShell() {
  const { workspaceId } = useParams()
  const fullBleed = useFullBleed()
  const askDevDock = useFeature('ask_devdock')
  const sidebarWidth = useSidebarWidth()
  return (
    // --sidebar-width is what every part of the sidebar (and the page beside it) is sized from.
    <SidebarProvider defaultOpen={sidebarStartsOpen()} style={{ '--sidebar-width': `${sidebarWidth.width}px` } as CSSProperties}>
      <AppSidebar sidebarWidth={sidebarWidth} />
      {/* min-w-0: wide content (the issue board) scrolls inside the page instead of widening it. */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4 md:px-6">
          {/* On a phone the sidebar is a slide-out panel: this opens it. On wider screens its own button does. */}
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Separator orientation="vertical" className="mr-2 h-4 data-vertical:self-center md:hidden" />
          {workspaceId ? <WorkspaceBreadcrumb /> : <TeamBreadcrumb />}
          <div className="ml-auto flex items-center gap-1">
            {/* A feature flag per group (/admin/flags); the ai-agent function checks it again. */}
            {askDevDock && <AskDevDockButton />}
            <NotesButton />
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>
        <NavigationSpinner />
        <NotePopups />
        <StatusSync />
        <NewWorkspaceListener />
        <PageArea fullBleed={fullBleed}>
          <Outlet />
        </PageArea>
      </SidebarInset>
    </SidebarProvider>
  )
}

type Crumb = { label: string; to: string }

/** The New dialog that lazy pages open with `openNewWorkspace()` (the Issues hub's "New project and import"). */
function NewWorkspaceListener() {
  const { can } = useCurrentTeam()
  return can.canManageWorkspaces ? <CreateWorkspaceDialog listen /> : null
}

/** Shares this tab's status with the group and receives everyone's (features/status). Renders nothing. */
function StatusSync() {
  const { team } = useCurrentTeam()
  useStatusSync(team.id)
  return null
}

function TeamBreadcrumb() {
  const { team } = useCurrentTeam()
  const { tools, members, settings, messages, reminders } = getTeamNav(team.slug, true, true)
  const section = useSection([messages, ...tools, reminders, members, settings])
  const item = useItemCrumb()
  return <Crumbs crumbs={[{ label: team.name, to: teamPath(team.slug) }, ...section, ...item]} />
}

function WorkspaceBreadcrumb() {
  const { team } = useCurrentTeam()
  const { workspace } = useCurrentWorkspace()
  const base = workspacePath(team.slug, workspace.id)
  const section = useSection([
    ...getWorkspaceTabs(team.slug, workspace.id, workspace.modules),
    { title: 'Settings', to: `${base}/settings`, icon: getTeamNav(team.slug).settings.icon },
  ])
  const item = useItemCrumb()
  return (
    <Crumbs
      crumbs={[
        { label: team.name, to: teamPath(team.slug) },
        { label: workspace.title, to: workspacePath(team.slug, workspace.id) },
        ...section,
        ...item,
      ]}
    />
  )
}

/**
 * On a doc, diagram, live session or issue page, its title (issue: identifier) as the last
 * crumb, but only where its loader would show it (same team/workspace).
 */
function useItemCrumb(): Crumb[] {
  const { docId, diagramId, sessionId, issueNumber, cycleNumber, lessonId, workspaceId, planId } = useParams()
  const { pathname } = useLocation()
  const { team } = useCurrentTeam()
  const doc = useQuery({ ...documentQuery(docId ?? ''), enabled: docId !== undefined }).data
  const diagram = useQuery({ ...diagramQuery(diagramId ?? ''), enabled: diagramId !== undefined }).data
  const session = useQuery({ ...liveSessionQuery(sessionId ?? ''), enabled: sessionId !== undefined }).data
  const issue = useQuery({
    ...issueQuery(workspaceId ?? '', Number(issueNumber)),
    enabled: issueNumber !== undefined && workspaceId !== undefined,
  }).data
  const workspace = useQuery({ ...workspaceQuery(workspaceId ?? ''), enabled: workspaceId !== undefined }).data
  const lesson = useQuery({ ...lessonQuery(lessonId ?? ''), enabled: lessonId !== undefined }).data
  // The plan page's loader has it cached: no request.
  const plan = useQuery({ ...planQuery(planId ?? ''), enabled: planId !== undefined }).data
  // The Issues hub's tabs and a plan: Issues › Plans › Custom Auth Roles.
  const hub = teamIssuesPath(team.slug)
  if (!workspaceId && (pathname === hub || pathname.startsWith(`${hub}/`))) {
    const rest = pathname.slice(hub.length).split('/').filter(Boolean)
    const tab = { plans: 'Plans', sprints: 'Sprints', views: 'Views', settings: 'Issue settings' }[rest[0] ?? ''] ?? 'My issues'
    const crumbs: Crumb[] = [{ label: tab, to: rest[0] ? `${hub}/${rest[0]}` : hub }]
    if (planId && plan && plan.team_id === team.id) crumbs.push({ label: plan.name, to: pathname })
    return crumbs
  }
  if (lessonId && lesson && lesson.workspace_id === workspaceId) return [{ label: lesson.title, to: pathname }]
  if (workspaceId && pathname.endsWith('/learning/progress')) return [{ label: 'Class progress', to: pathname }]
  if (issueNumber && issue && workspace) {
    return [{ label: issueIdentifier(workspace.issue_key, issue.number), to: pathname }]
  }
  if (workspaceId && pathname.includes('/issues/cycles')) {
    const cycles = `${pathname.split('/issues/cycles')[0]}/issues/cycles`
    return [
      { label: 'Sprints', to: cycles },
      ...(cycleNumber ? [{ label: `Sprint ${cycleNumber}`, to: pathname }] : []),
    ]
  }
  const item = docId ? doc : diagramId ? diagram : sessionId ? session : undefined
  const belongs =
    item && item.team_id === team.id && (workspaceId === undefined || item.workspace_id === workspaceId)
  return belongs ? [{ label: item.title, to: pathname }] : []
}

/** The current non-index nav item as a crumb, if any. */
function useSection(items: NavItem[]): Crumb[] {
  const { pathname } = useLocation()
  const item = items.find((i) => !i.end && isNavActive(i, pathname))
  return item ? [{ label: item.title, to: item.to }] : []
}

function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, i) => (
          <Fragment key={`${i}:${crumb.to}`}>
            {i > 0 && <BreadcrumbSeparator className="hidden sm:block" />}
            <BreadcrumbItem className={i < crumbs.length - 1 ? 'hidden min-w-0 sm:inline-flex' : 'min-w-0'}>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild className="truncate">
                  <Link to={crumb.to}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
