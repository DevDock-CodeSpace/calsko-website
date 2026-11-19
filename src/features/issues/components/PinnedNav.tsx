import { useQuery } from '@tanstack/react-query'
import { ChevronDown, IterationCw, Layers, ListTodo, MoreHorizontal, UserCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, matchPath, useLocation } from 'react-router'
import { PersonAvatar } from '@/components/PersonRow'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { teamMembersQuery } from '@/features/teams/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { cyclePath, cyclesPath, issuePath, issuesPath, planPath, teamIssuesPath, workspaceDefaultPath } from '@/features/teams/nav'
import { workspaceTypes } from '@/features/teams/permissions'
import { teamPlansQuery } from '@/features/plans/api'
import { PlanStatusDot } from '@/features/plans/components/PlanStatusDot'
import { useCollectionView } from '@/features/collections/hooks'
import { FACETS, ISSUE_TABS, readFilters, readTab } from '../filters'
import { personHref, personOf, readViewState, tabHref, viewHref, VIEW_PARAM } from '../views'
import { cycleTitle } from '../cycles'
import { issueIdentifier } from '../meta'
import { starredIssuesQuery, pinnedCyclesQuery, teamViewsQuery, type IssuePin } from '../viewsApi'
import { StatusIcon } from './StatusIcon'
import { usePins } from '../viewsHooks'

/** How many starred items show before "N more". */
const VISIBLE = 6

type Item = { pin: IssuePin; label: string; where: string; to: string; icon: ReactNode; active: boolean }

/**
 * The sidebar's Starred list (owner's choice, 2026-10-27: one ☆ for everything, under Settings with
 * a wide gap): workspaces, issues, plans and My issues, plus a project's saved views, people's
 * issues, tabs and sprints starred from its Issues page. Anything you can no longer see is left out
 * (a starred workspace follows the collection view, like the rest of the sidebar). The names of
 * starred issues and plans load only when there are some.
 */
export function PinnedNav({ onNavigate }: { onNavigate: () => void }) {
  const { team } = useCurrentTeam()
  const { pathname, search } = useLocation()
  const { pins, remove, reorder } = usePins(team.id)
  const views = useQuery(teamViewsQuery(team.id)).data
  // Pins follow the collection being looked at, like the rest of the sidebar.
  const { workspaces } = useCollectionView()
  // Only to name starred people: without one, the sidebar doesn't ask for the group's people on every load.
  const people = useQuery({ ...teamMembersQuery(team.id), enabled: pins.some((pin) => pin.kind === 'person') }).data
  const cycles = useQuery(pinnedCyclesQuery(pins.flatMap((pin) => (pin.cycle_id ? [pin.cycle_id] : [])))).data
  const issues = useQuery(starredIssuesQuery(pins.flatMap((pin) => (pin.kind === 'issue' && pin.issue_id ? [pin.issue_id] : [])))).data
  const plans = useQuery({ ...teamPlansQuery(team.id), enabled: pins.some((pin) => pin.kind === 'plan') }).data
  const [expanded, setExpanded] = useState(false)
  // The project's name only helps when there is more than one to tell apart.
  const showWhere = workspaces.length > 1
  const params = new URLSearchParams(search)

  const items: Item[] = pins.flatMap((pin): Item[] => {
    // Not tied to one project.
    if (pin.kind === 'my_issues') {
      const to = teamIssuesPath(team.slug)
      return [{ pin, label: 'My issues', where: '', to, icon: <UserCheck />, active: pathname === to }]
    }
    if (pin.kind === 'plan') {
      const plan = plans?.find((item) => item.id === pin.plan_id)
      if (!plan) return []
      const to = planPath(team.slug, plan.id)
      return [{ pin, label: plan.name, where: 'Plan', to, icon: <span className="flex size-[18px] items-center justify-center"><PlanStatusDot status={plan.status} /></span>, active: pathname === to }]
    }
    const workspace = workspaces.find((item) => item.id === pin.workspace_id)
    if (!workspace) return []
    if (pin.kind === 'workspace') {
      const to = workspaceDefaultPath(team.slug, workspace)
      const Icon = workspaceTypes[workspace.type].icon
      return [{ pin, label: workspace.title, where: '', to, icon: <Icon />, active: matchPath({ path: to, end: false }, pathname) !== null }]
    }
    if (pin.kind === 'issue') {
      const issue = issues?.find((item) => item.id === pin.issue_id)
      if (!issue) return []
      const to = issuePath(team.slug, workspace.id, issue.number)
      return [
        {
          pin,
          label: issue.title,
          where: issueIdentifier(issue.workspace.issue_key, issue.number),
          to,
          icon: <span className="flex size-[18px] items-center justify-center"><StatusIcon status={issue.status} /></span>,
          active: pathname === to,
        },
      ]
    }
    const base = issuesPath(team.slug, workspace.id)
    const here = pathname === base
    const plain = FACETS.every((facet) => readFilters(params)[facet].length === 0)
    if (pin.kind === 'view') {
      const view = views?.find((item) => item.id === pin.view_id)
      if (!view) return []
      return [{ pin, label: view.name, where: workspace.title, to: viewHref(base, view), icon: <Layers />, active: here && params.get(VIEW_PARAM) === view.id }]
    }
    if (pin.kind === 'person') {
      const person = people?.find((item) => item.user_id === pin.person_id)
      if (!person || !pin.person_id) return []
      return [
        {
          pin,
          label: person.profile?.display_name ?? 'Unnamed member',
          where: workspace.title,
          to: personHref(base, pin.person_id),
          icon: <PersonAvatar profile={person.profile} className="size-4" fallbackClassName="text-[8px]" />,
          active: here && !params.has(VIEW_PARAM) && personOf(readViewState(params)) === pin.person_id,
        },
      ]
    }
    if (pin.kind === 'cycle') {
      const cycle = cycles?.find((item) => item.id === pin.cycle_id)
      if (!cycle) return []
      const to = cyclePath(team.slug, workspace.id, cycle.number)
      return [{ pin, label: cycleTitle(cycle), where: workspace.title, to, icon: <IterationCw />, active: pathname === to }]
    }
    if (pin.kind === 'current_cycle') {
      const to = `${cyclesPath(team.slug, workspace.id)}/current`
      return [{ pin, label: 'Current sprint', where: workspace.title, to, icon: <IterationCw />, active: pathname === to }]
    }
    const tab = ISSUE_TABS.find((item) => item.id === pin.tab)
    if (!tab) return []
    return [{ pin, label: tab.label, where: workspace.title, to: tabHref(base, tab.id), icon: <ListTodo />, active: here && !params.has(VIEW_PARAM) && plain && readTab(params) === tab.id }]
  })

  if (items.length === 0) return null
  const shown = expanded ? items : items.slice(0, VISIBLE)
  const hiddenIds = pins.filter((pin) => !items.some((item) => item.pin.id === pin.id)).map((pin) => pin.id)

  const move = (index: number, by: -1 | 1) => {
    const order = items.map((item) => item.pin.id)
    const target = index + by
    ;[order[index], order[target]] = [order[target], order[index]]
    reorder.mutate([...order, ...hiddenIds])
  }

  return (
    // Under the group's Members and Settings, set apart by a wide gap (owner's choice, 2026-10-27).
    <SidebarGroup className="mt-6 pb-0">
      <SidebarGroupLabel>Starred</SidebarGroupLabel>
      <SidebarMenu>
        {shown.map((item, index) => (
          <SidebarMenuItem key={item.pin.id}>
            <SidebarMenuButton asChild tooltip={`${item.label} · ${item.where}`} isActive={item.active} className="data-active:[&_svg]:text-brand">
              <Link to={item.to} onClick={onNavigate}>
                {item.icon}
                <span className="min-w-0 truncate">{item.label}</span>
                {(showWhere || item.pin.kind === 'issue') && item.where && <span className="ml-auto max-w-20 shrink-0 truncate text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">{item.where}</span>}
              </Link>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction showOnHover aria-label={`Options for ${item.label}`}>
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem onSelect={() => remove.mutate(item.pin.id)}>Unstar</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, -1)}>Move up</DropdownMenuItem>
                <DropdownMenuItem disabled={index === items.length - 1} onSelect={() => move(index, 1)}>Move down</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
        {items.length > VISIBLE && (
          <SidebarMenuItem>
            <SidebarMenuButton className="text-muted-foreground" onClick={() => setExpanded((open) => !open)}>
              <ChevronDown className={expanded ? 'rotate-180' : undefined} />
              <span>{expanded ? 'Show fewer' : `${items.length - VISIBLE} more`}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
