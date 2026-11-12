import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, PanelLeft, Plus } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { LogoMark } from '@/components/Logo'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { useAuth } from '@/features/auth/hooks'
import { useCollectionView } from '@/features/collections/hooks'
import { availableCollections, pickCollection, readCollectionView, rememberCollectionView } from '@/features/collections/view'
import { teamCollectionsQuery, teamWorkspacesQuery } from '@/features/workspaces/api'
import { teamLogoUrl, type Team } from '../api'
import { useCurrentTeam, useMyTeams } from '../hooks'
import { startPath } from '../landing'
import { teamPermissions, teamRoleName, teamTypes } from '../permissions'

/**
 * The group menu. A group with collections opens a second menu listing them: picking one shows that
 * collection alone (sidebar and group pages), which is how its parts are kept from blurring together.
 */
export function TeamSwitcher() {
  const { user } = useAuth()
  const { team } = useCurrentTeam()
  // Closed by a click elsewhere: don't hand focus back to the button, or Chrome draws the keyboard
  // focus ring on it. Closed with the keyboard (Esc), focus still returns so keyboard users keep their place.
  const closedByPointer = useRef(false)
  const view = useCollectionView()
  const memberships = useMyTeams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar()

  const open = (slug: string, teamId: string, collectionId?: string) => {
    if (collectionId) rememberCollectionView(teamId, collectionId)
    if (isMobile) setOpenMobile(false)
    // Through the start route: a learning collection or group opens your course, the rest open Chat.
    navigate(startPath(slug, { collectionSwitch: teamId === team.id && collectionId !== undefined }))
  }

  // Collapsed to icons there is no room for the menu and the sidebar button side by side: the logo
  // becomes the button that opens the sidebar (it shows the panel icon on hover), as in ChatGPT.
  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip="Open sidebar" onClick={toggleSidebar} className="group/open">
            <span className="relative grid size-8 shrink-0 place-items-center">
              <GroupIcon
                team={team}
                className="size-8 transition-opacity group-hover/open:opacity-0 group-focus-visible/open:opacity-0"
                fallback={<LogoMark className="size-8 object-contain transition-opacity group-hover/open:opacity-0 group-focus-visible/open:opacity-0" />}
              />
              <PanelLeft className="absolute opacity-0 transition-opacity group-hover/open:opacity-100 group-focus-visible/open:opacity-100" />
            </span>
            <span className="sr-only">Toggle Sidebar</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    // Fills the header up to the sidebar button (AppSidebar), so the menu's arrow sits right beside it.
    <SidebarMenu className="min-w-0 flex-1">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={view.collection ? `${team.name} · ${view.collection.name}` : team.name}
              className="w-full pr-1.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <GroupIcon team={team} className="size-8" fallback={<LogoMark className="size-8 object-contain" />} />
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{team.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {/* The collection in view, else what kind of group it is (Learning, Development, General). */}
                  {view.collection ? view.collection.name : teamTypes[team.type].label}
                </span>
              </div>
              <ChevronDown className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={4}
            className="min-w-60"
            onPointerDownOutside={() => (closedByPointer.current = true)}
            onCloseAutoFocus={(event) => {
              if (closedByPointer.current) event.preventDefault()
              closedByPointer.current = false
            }}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Groups</DropdownMenuLabel>
            {memberships.map((m) => {
              const Icon = teamTypes[m.team.type].icon
              const current = m.team.id === team.id
              // The open group's collections are loaded; another group's are known only if it was
              // opened earlier in this tab (no request is made just to draw this menu).
              const collections = current
                ? view.collections
                : availableCollections(
                    queryClient.getQueryData(teamCollectionsQuery(m.team.id).queryKey)?.collections ?? [],
                    queryClient.getQueryData(teamWorkspacesQuery(m.team.id).queryKey)?.workspaces ?? [],
                    user.id,
                    teamPermissions(m.role).isAdmin,
                  )
              const shown = current
                ? view.collection
                : pickCollection(collections, readCollectionView(m.team.id), user.id)
              const row = (
                <>
                  <GroupIcon team={m.team} className="size-4" fallback={<Icon className="text-muted-foreground" />} />
                  <span className="flex-1 truncate">{m.team.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{teamRoleName(m.role, m.team.type).toLowerCase()}</span>
                  {current && collections.length === 0 && <Check className="size-4" />}
                </>
              )
              if (collections.length === 0) {
                return (
                  <DropdownMenuItem key={m.team.id} onSelect={() => open(m.team.slug, m.team.id)}>
                    {row}
                  </DropdownMenuItem>
                )
              }
              return (
                <DropdownMenuSub key={m.team.id}>
                  <DropdownMenuSubTrigger>{row}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-52">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Collections in {m.team.name}</DropdownMenuLabel>
                    {collections.map((collection) => {
                      const CollectionIcon = teamTypes[collection.type].icon
                      return (
                        <DropdownMenuItem key={collection.id} onSelect={() => open(m.team.slug, m.team.id, collection.id)}>
                          <CollectionIcon className="text-muted-foreground" />
                          <span className="flex-1 truncate">{collection.name}</span>
                          {current && shown?.id === collection.id && <Check className="size-4" />}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/onboarding">
                <Plus /> Create or join a group
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** A group's custom icon logo when it has one, else the given fallback (the Calsko mark or type icon). */
function GroupIcon({ team, className, fallback }: { team: Team; className?: string; fallback: ReactNode }) {
  if (!team.logo_path) return fallback
  return <img src={teamLogoUrl(team.logo_path)} alt="" className={cn('shrink-0 rounded-md object-cover', className)} />
}
