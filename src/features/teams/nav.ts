import {
  Bookmark,
  BookOpen,
  CalendarDays,
  CircleCheckBig,
  Files,
  FileText,
  GitPullRequest,
  LayoutDashboard,
  MessageSquare,
  Presentation,
  Settings,
  Shapes,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { matchPath } from 'react-router'
import type { TeamType } from '@/features/teams/api'
import type { WorkspaceModule, WorkspaceType } from '@/features/workspaces/api'

export type NavItem = {
  title: string
  to: string
  icon: LucideIcon
  /** Match the path exactly (for index routes). */
  end?: boolean
  /** Another path that counts as being here (Files: a diagram's page, …/diagrams/<id>). */
  also?: string
}

/** Whether `pathname` is on this item (its path, or its `also` path). */
export const isNavActive = (item: NavItem, pathname: string) =>
  matchPath({ path: item.to, end: item.end ?? false }, pathname) !== null ||
  (item.also !== undefined && matchPath({ path: item.also, end: false }, pathname) !== null)

export const teamPath = (slug: string) => `/t/${slug}`
/** Where a group opens (after signing in, switching or joining): its Chat. */
export const chatPath = (slug: string) => `${teamPath(slug)}/messages`
export const workspacePath = (teamSlug: string, workspaceId: string) => `/t/${teamSlug}/w/${workspaceId}`

/**
 * Files (the UI name; code and URLs say docs): the folders of docs and diagrams, in the team view
 * or inside a workspace; `folder` opens it inside a folder.
 */
export const filesPath = (teamSlug: string, workspaceId?: string, options: { folder?: string | null } = {}) =>
  `${docsPath(teamSlug, workspaceId)}${options.folder ? `?folder=${options.folder}` : ''}`
/** Docs list, in the team view or inside a workspace (the Files page). */
export const docsPath = (teamSlug: string, workspaceId?: string) =>
  workspaceId ? `${workspacePath(teamSlug, workspaceId)}/docs` : `${teamPath(teamSlug)}/docs`
/** One doc, opened from the team view or from inside its workspace. */
export const docPath = (teamSlug: string, docId: string, workspaceId?: string) =>
  `${docsPath(teamSlug, workspaceId)}/${docId}`

/** Where diagrams' URLs live (`…/diagrams/<id>`); the list itself redirects to Files. */
export const diagramsPath = (teamSlug: string, workspaceId?: string) =>
  workspaceId ? `${workspacePath(teamSlug, workspaceId)}/diagrams` : `${teamPath(teamSlug)}/diagrams`
/** One diagram, opened from the team view or from inside its workspace. */
export const diagramPath = (teamSlug: string, diagramId: string, workspaceId?: string) =>
  `${diagramsPath(teamSlug, workspaceId)}/${diagramId}`

/** Issues are workspace-only (no team-wide view). */
export const issuesPath = (teamSlug: string, workspaceId: string) => `${workspacePath(teamSlug, workspaceId)}/issues`
/** A workspace's cycles, and one cycle by its number. */
export const cyclesPath = (teamSlug: string, workspaceId: string) => `${issuesPath(teamSlug, workspaceId)}/cycles`
export const cyclePath = (teamSlug: string, workspaceId: string, number: number) =>
  `${cyclesPath(teamSlug, workspaceId)}/${number}`
/** One issue, by its number in the workspace (CAP-12 → 12). */
export const issuePath = (teamSlug: string, workspaceId: string, number: number) =>
  `${issuesPath(teamSlug, workspaceId)}/${number}`

// ------------------------------------------------------------ team tools
// Team-wide views of the same data a workspace tab shows. Future rows carry
// team_id (required) + workspace_id (optional): null = team-wide, X = assigned
// to workspace X. Team → Files lists everything the caller can access; a
// workspace's Files tab lists only rows with that workspace_id. Workspace-only
// tools (Issues, Learning, Exercises, GitHub) have no team view.
//
// Docs and diagrams are two tools (workspace_modules) shown as one page, **Files**:
// the sidebar item and the workspace tab are `docs`'s, and the old Diagrams list
// redirects there.

export type TeamToolId = Extract<WorkspaceModule, 'docs' | 'diagrams' | 'live'>
/** The sidebar's tools: Files (docs and diagrams) and Meetings. */
export const TEAM_TOOLS: TeamToolId[] = ['docs', 'live']

/** The one page docs and diagrams share: its sidebar item and workspace tab. */
export const FILES_TAB = { title: 'Files', icon: Files }

export const teamToolDefs: Record<TeamToolId, { item: string; items: string }> = {
  docs: { item: 'doc', items: 'docs' },
  diagrams: { item: 'whiteboard', items: 'whiteboards' },
  live: { item: 'meeting', items: 'meetings' },
}

export function isTeamTool(tool: string): tool is TeamToolId {
  return (TEAM_TOOLS as string[]).includes(tool)
}

/** The old Notes page's address; it now redirects to the header's Notes panel (`?note=`). The code and URL say reminders; the UI says Notes. */
export const remindersPath = (slug: string) => `${teamPath(slug)}/reminders`

/** Group-wide issues: every project's issues in one list. */
/** The Issues hub (sidebar → Issues): My issues, Plans, Sprints, Views (docs/ISSUES_HUB_PLAN.md). */
export const teamIssuesPath = (slug: string) => `${teamPath(slug)}/issues`
export const hubPlansPath = (slug: string) => `${teamIssuesPath(slug)}/plans`
export const planPath = (slug: string, planId: string) => `${hubPlansPath(slug)}/${planId}`
export const hubSprintsPath = (slug: string) => `${teamIssuesPath(slug)}/sprints`
export const hubViewsPath = (slug: string) => `${teamIssuesPath(slug)}/views`
export const hubSettingsPath = (slug: string) => `${teamIssuesPath(slug)}/settings`

/**
 * Whether the group has a group-wide Issues page: development groups always,
 * any other group once it has a project the caller can see.
 */
export function hasTeamIssues(type: TeamType, workspaces: readonly { type: WorkspaceType }[]): boolean {
  return type === 'development' || workspaces.some((w) => w.type === 'project')
}

/**
 * Sidebar team links: Chat + team tools on top (plus Issues below Meetings
 * when `issues` is set, see hasTeamIssues, then your Reminders), then the
 * workspaces, then Members/Settings.
 */
/**
 * Whether the group has a Learning page (Teaching / My learning / Browse): learning groups always, any
 * other group once it has a course the caller can see, and for its teachers.
 */
export function hasTeamLearning(type: TeamType, workspaces: readonly { type: WorkspaceType }[], role?: string): boolean {
  return type === 'learning' || role === 'teacher' || workspaces.some((w) => w.type === 'course')
}

export const teamLearningPath = (slug: string) => `${teamPath(slug)}/learning`

export function getTeamNav(
  slug: string,
  issues = false,
  learning = false,
): {
  tools: (NavItem & { id: TeamToolId | 'issues' | 'learning' })[]
  members: NavItem
  settings: NavItem
  messages: NavItem
  reminders: NavItem
} {
  const base = teamPath(slug)
  return {
    messages: { title: 'Chat', to: `${base}/messages`, icon: MessageSquare },
    tools: [
      // A learning group's lessons first: what students and teachers open most.
      ...(learning ? [{ id: 'learning' as const, title: 'Learning', icon: workspaceTabDefs.learning.icon, to: teamLearningPath(slug) }] : []),
      ...TEAM_TOOLS.map((id) => ({
        id,
        ...(id === 'docs' ? { ...FILES_TAB, also: `${base}/diagrams` } : { title: workspaceTabDefs[id].title, icon: workspaceTabDefs[id].icon }),
        to: `${base}/${id}`,
      })),
      ...(issues
        ? [{ id: 'issues' as const, title: 'Issues', icon: workspaceTabDefs.issues.icon, to: teamIssuesPath(slug) }]
        : []),
    ],
    // Not in the sidebar: notes live in the header's panel, and this old address redirects there. Kept for
    // AppLayout's section names, and because dropping it regroups the build's chunks (+7 KB first load).
    reminders: { title: 'Notes', to: remindersPath(slug), icon: Bookmark },
    members: { title: 'Members', to: `${base}/members`, icon: Users },
    settings: { title: 'Settings', to: `${base}/settings`, icon: Settings },
  }
}

// ------------------------------------------------------------ workspace tabs
// Tabs are generated from the workspace's enabled modules (workspace_modules).
// Overview and Members are always present and aren't modules.

export type WorkspaceTabId = 'overview' | WorkspaceModule | 'members'

export const workspaceTabDefs: Record<
  WorkspaceTabId,
  { title: string; icon: LucideIcon; hint?: string; soon?: string }
> = {
  overview: { title: 'Overview', icon: LayoutDashboard },
  learning: { title: 'Learning', icon: BookOpen, hint: 'Modules, lessons and progress' },
  issues: { title: 'Issues', icon: CircleCheckBig, hint: 'Linear-style tasks and bugs' },
  docs: { title: 'Docs', icon: FileText, hint: 'Pages and notes, in Files', soon: 'Docs assigned to this workspace will live here.' },
  diagrams: { title: 'Whiteboards', icon: Presentation, hint: 'Draw freely or with shapes: lessons, architecture, schemas. In Files', soon: 'Whiteboards assigned to this workspace will live here.' },
  exercises: { title: 'Exercises', icon: Shapes, hint: 'Practice and submissions', soon: 'Exercises and submissions will live here.' },
  github: { title: 'GitHub', icon: GitPullRequest, hint: 'Linked repositories' },
  live: { title: 'Meetings', icon: CalendarDays, hint: 'Video meetings and schedule' },
  members: { title: 'Members', icon: Users },
}

/** Canonical tab order, whatever order modules were enabled in. */
export const MODULE_ORDER: WorkspaceModule[] = [
  'learning',
  'issues',
  'docs',
  'diagrams',
  'exercises',
  'github',
  'live',
]

/** Mirrors public.default_workspace_modules() in the database. Defaults only. */
export const defaultModules: Record<WorkspaceType, WorkspaceModule[]> = {
  project: ['issues', 'docs', 'diagrams', 'github', 'live'],
  course: ['learning', 'docs', 'diagrams', 'exercises', 'live'],
  general: ['docs', 'diagrams', 'live'],
}

export function sortModules(modules: readonly WorkspaceModule[]): WorkspaceModule[] {
  return MODULE_ORDER.filter((m) => modules.includes(m))
}

export function hasWorkspaceTab(modules: readonly WorkspaceModule[], tab: string): tab is WorkspaceModule {
  return (modules as readonly string[]).includes(tab)
}

/** Whether the workspace has the Files tab: either of its tools (docs, diagrams) is on. */
export const hasFiles = (modules: readonly WorkspaceModule[]) => modules.includes('docs') || modules.includes('diagrams')

/**
 * Overview | …enabled modules… | Members. Overview is the index route. Docs and diagrams
 * share one tab, Files, in docs's place (shown when either is on).
 */
export function getWorkspaceTabs(
  teamSlug: string,
  workspaceId: string,
  modules: readonly WorkspaceModule[],
): (NavItem & { id: WorkspaceTabId })[] {
  const base = workspacePath(teamSlug, workspaceId)
  const tools = sortModules(hasFiles(modules) ? [...modules, 'docs'] : modules).filter((m) => m !== 'diagrams')
  const ids: WorkspaceTabId[] = ['overview', ...tools, 'members']
  return ids.map((id) => ({
    id,
    ...(id === 'docs' ? { ...FILES_TAB, also: `${base}/diagrams` } : { title: workspaceTabDefs[id].title, icon: workspaceTabDefs[id].icon }),
    to: id === 'overview' ? base : `${base}/${id}`,
    end: id === 'overview',
  }))
}

/** A workspace's course outline, one lesson, and the managers' progress table. */
export const learningPath = (teamSlug: string, workspaceId: string) => `${workspacePath(teamSlug, workspaceId)}/learning`
export const lessonPath = (teamSlug: string, workspaceId: string, lessonId: string) =>
  `${learningPath(teamSlug, workspaceId)}/${lessonId}`
export const learningProgressPath = (teamSlug: string, workspaceId: string) =>
  `${learningPath(teamSlug, workspaceId)}/progress`

/** Meetings list and calendar, in the group view or inside a workspace. */
export const livePath = (teamSlug: string, workspaceId?: string) =>
  workspaceId ? `${workspacePath(teamSlug, workspaceId)}/live` : `${teamPath(teamSlug)}/live`
/** One meeting, opened from the group view or from inside its workspace. */
export const liveSessionPath = (teamSlug: string, sessionId: string, workspaceId?: string) =>
  `${livePath(teamSlug, workspaceId)}/${sessionId}`
