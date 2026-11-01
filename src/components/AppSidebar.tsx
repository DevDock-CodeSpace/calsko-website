import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ChevronRight, Plus, Star } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, matchPath, useLocation, useParams } from 'react-router'
import { TruncatedText } from '@/components/TruncatedText'
import { cn } from '@/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { SidebarResizer } from '@/components/SidebarResizer'
import type { SidebarWidth } from '@/hooks/use-sidebar-width'
import { teamIssuesQuery } from '@/features/issues/api'
import { PinnedNav } from '@/features/issues/components/PinnedNav'
import { teamPlansQuery } from '@/features/plans/api'
import { useUnread } from '@/features/messaging/hooks'
import { UserMenu } from '@/features/auth/components/UserMenu'
import { TeamSwitcher } from '@/features/teams/components/TeamSwitcher'
import { useCurrentTeam } from '@/features/teams/hooks'
import { getTeamNav, hasTeamIssues, hasTeamLearning, isNavActive, teamPath, workspacePath, type NavItem } from '@/features/teams/nav'
import { collectionTypeOrder, workspaceTypeOrder, workspaceTypes } from '@/features/teams/permissions'
import { useCollectionView } from '@/features/collections/hooks'
import { rememberCollectionView } from '@/features/collections/view'
import { teamWorkspacesQuery } from '@/features/workspaces/api'
import { CreateWorkspaceDialog } from '@/features/workspaces/components/CreateWorkspaceDialog'
import { useRecentVisits, useWorkspaceStars } from '@/features/workspaces/hooks'
import { pickSidebarItems } from '@/features/workspaces/recent'

// Active item: accent background (from shadcn) + Calsko-blue icon.
const activeIcon = 'data-active:[&_svg]:text-brand'

/**
 * The sidebar is the hierarchy: team → its workspaces, grouped by workspace
 * type (Courses, Projects, Spaces). The team tools on top (Docs, Diagrams,
 * Meetings) are team-wide views; inside a workspace the same tools are tabs that
 * show only that workspace's items. Workspace features are never sidebar items.
 * Each type section shows at most 3: pinned first, then recently opened. The
 * section title ("Courses · 5") links to the full list.
 */
export function AppSidebar({ sidebarWidth }: { sidebarWidth: SidebarWidth }) {
  const { team, role, can } = useCurrentTeam()
  // One collection at a time: the sidebar shows what is in the one being looked at (everything, in a
  // group without collections). Reads the cache entry the shell loaded, so it adds no request.
  const { collection, workspaces } = useCollectionView()
  const everything = useSuspenseQuery(teamWorkspacesQuery(team.id)).data
  const { pathname } = useLocation()
  const { workspaceId } = useParams()
  const { isMobile, setOpenMobile } = useSidebar()
  const { isStarred, setStarred } = useWorkspaceStars(team.id)
  const visits = useRecentVisits(team.id)
  // Inside a collection its own type and contents decide whether Issues shows, not the group's.
  const nav = getTeamNav(
    team.slug,
    hasTeamIssues(collection?.type ?? team.type, workspaces),
    hasTeamLearning(collection?.type ?? team.type, workspaces, role),
  )
  const unreadMessages = useUnread(team.id).total
  // One section per workspace type that has items; the collection's type (else the group's) decides
  // which comes first.
  const base = teamPath(team.slug)
  const sections = (collection ? collectionTypeOrder(collection.type) : workspaceTypeOrder(team.type))
    .map((type) => ({
      key: type,
      title: workspaceTypes[type].plural,
      allTitle: `All ${workspaceTypes[type].plural.toLowerCase()}`,
      allHref: `${base}?type=${type}`,
      items: workspaces.filter((w) => w.type === type),
    }))
    .filter((section) => section.items.length > 0)
  // Opening something from another collection (a link, a pin, a notification) switches the view to
  // it, so the sidebar always shows where you are.
  const openCollectionId = everything.find((w) => w.id === workspaceId)?.collection_id ?? null
  const viewId = collection?.id ?? null
  // Once per workspace opened, not on every change of view: choosing another collection in the group
  // menu while a workspace is open changes the view first and navigates after, and following the
  // still-open workspace at that moment would undo the choice.
  const followed = useRef<string | null>(null)
  useEffect(() => {
    const opened = workspaceId ?? null
    if (followed.current === opened) return
    followed.current = opened
    if (openCollectionId && viewId && openCollectionId !== viewId) rememberCollectionView(team.id, openCollectionId)
  }, [workspaceId, openCollectionId, viewId, team.id])
  const close = () => isMobile && setOpenMobile(false)
  // Pointing at Issues starts what the hub's first tab needs (its data and its code), so the click
  // rarely waits. prefetchQuery skips fresh cache entries, so hovering again costs nothing.
  const queryClient = useQueryClient()
  const prefetchIssues = () => {
    void queryClient.prefetchQuery(teamIssuesQuery(team.id))
    void queryClient.prefetchQuery(teamPlansQuery(team.id))
    void import('@/routes/team/HubMyIssuesPage')
  }

  return (
    <Sidebar collapsible="icon">
      {/* Match the app header (h-12 + border-b) so the team switcher lines up with the top bar.
          The same px-2 collapsed or not keeps the logo centered over the icon column below. */}
      <SidebarHeader className="h-12 flex-row items-center gap-0 border-b px-2 py-0">
        <TeamSwitcher />
        {/* Closes the sidebar from inside it (ChatGPT-style); collapsed, the logo opens it again. Shifted
            towards the sidebar's edge without moving the group menu's arrow (a transform takes no space). */}
        <SidebarTrigger className="-ml-1 shrink-0 translate-x-1.5 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </SidebarHeader>

      {/* Menu icons a touch larger than the 16 px shadcn default (owner's ask); only the sidebar's items. */}
      <SidebarContent className="gap-0 [&_[data-sidebar=menu-button]_svg]:size-[18px]">
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <NavLinkItem item={nav.messages} onNavigate={close} badge={unreadMessages} />
            {nav.tools.map((item) => (
              <NavLinkItem key={item.id} item={item} onNavigate={close} onIntent={item.id === 'issues' ? prefetchIssues : undefined} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {sections.map(({ key, title, allTitle, allHref, items }) => {
          const { shown } = pickSidebarItems(items, visits, workspaceId)
          return (
            <SidebarGroup key={key} className="pb-0">
              {/* The title opens the full list of this type. */}
              <SidebarGroupLabel asChild>
                <Link
                  to={allHref}
                  onClick={close}
                  title={allTitle}
                  className="group/label gap-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <TruncatedText text={title} />
                  <span className="shrink-0 font-mono text-[10px] opacity-70">· {items.length}</span>
                  <ChevronRight className="ml-auto opacity-0 transition-opacity group-hover/label:opacity-100" />
                </Link>
              </SidebarGroupLabel>
              <SidebarMenu>
                {shown.map((workspace) => {
                  const to = workspacePath(team.slug, workspace.id)
                  const Icon = workspaceTypes[workspace.type].icon
                  const starred = isStarred(workspace.id)
                  return (
                    <SidebarMenuItem key={workspace.id}>
                      <SidebarMenuButton
                        asChild
                        tooltip={workspace.title}
                        // The star only shows on hover or focus (unless starred); keep its room free until then,
                        // so the name isn't cut short by an invisible button. Touch screens always show it.
                        className={cn(
                          activeIcon,
                          !starred &&
                            'md:group-has-data-[sidebar=menu-action]/menu-item:pr-2 md:group-hover/menu-item:group-has-data-[sidebar=menu-action]/menu-item:pr-8 md:group-focus-within/menu-item:group-has-data-[sidebar=menu-action]/menu-item:pr-8',
                        )}
                        isActive={matchPath({ path: to, end: false }, pathname) !== null}
                      >
                        <Link to={to} onClick={close}>
                          <Icon />
                          <TruncatedText text={workspace.title} />
                        </Link>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover={!starred}
                        aria-label={starred ? `Unstar ${workspace.title}` : `Star ${workspace.title}`}
                        title={starred ? 'Unstar' : 'Star'}
                        onClick={() => setStarred(workspace.id, !starred)}
                      >
                        <Star className={starred ? 'fill-amber-400 text-amber-400' : undefined} />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}

        {(can.canManageWorkspaces || workspaces.length === 0) && (
          <SidebarGroup className={sections.length > 0 ? 'pt-0' : undefined}>
            <SidebarMenu>
              {workspaces.length === 0 && !can.canManageWorkspaces && (
                <li className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Nothing in this group is open to you yet.
                </li>
              )}
              {can.canManageWorkspaces && (
                <SidebarMenuItem>
                  <CreateWorkspaceDialog
                    trigger={
                      <SidebarMenuButton tooltip="New" className="text-muted-foreground">
                        <Plus />
                        <span>New</span>
                      </SidebarMenuButton>
                    }
                  />
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Group</SidebarGroupLabel>
          <SidebarMenu>
            <NavLinkItem item={nav.members} onNavigate={close} />
            <NavLinkItem item={nav.settings} onNavigate={close} />
          </SidebarMenu>
        </SidebarGroup>

        <PinnedNav onNavigate={close} />
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarResizer sidebar={sidebarWidth} />
    </Sidebar>
  )
}

function NavLinkItem({ item, onNavigate, onIntent, badge = 0 }: { item: NavItem; onNavigate: () => void; onIntent?: () => void; badge?: number }) {
  const { pathname } = useLocation()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={item.title}
        className={activeIcon}
        isActive={isNavActive(item, pathname)}
      >
        <Link to={item.to} onClick={onNavigate} onPointerEnter={onIntent} onFocus={onIntent}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {badge > 0 && <SidebarMenuBadge className="font-mono">{badge > 99 ? '99+' : badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )
}
