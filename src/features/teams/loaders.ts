import { data, redirect, type LoaderFunctionArgs } from 'react-router'
import { amPlatformAdminQuery } from '@/features/admin/api'
import { starterPagePreferenceQuery } from '@/features/auth/api'
import { requireUser } from '@/features/auth/loaders'
import { teamPinsQuery, teamViewsQuery } from '@/features/issues/viewsApi'
import { notificationsQuery, unreadCountsQuery } from '@/features/messaging/api'
import { availableCollections, pickCollection, readCollectionView } from '@/features/collections/view'
import { myWorkspaceRolesQuery, teamContentsQuery, teamWorkspacesQuery, workspaceMembersQuery, workspaceQuery } from '@/features/workspaces/api'
import { readRecentVisits } from '@/features/workspaces/recent'
import { queryClient } from '@/lib/query-client'
import { invitesQuery, myTeamsQuery, teamMembersQuery } from './api'
import { lastTeam, rememberTeam } from './last-team'
import { landingPath, startPath, starterPagePath } from './landing'

/**
 * /app: send the user where their last/first team opens (`teamStartLoader`); with no team, the platform
 * admin to its console and everyone else to onboarding. Only people without a group pay for the check.
 */
export async function appIndexLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const memberships = await queryClient.fetchQuery(myTeamsQuery(user.id))
  if (memberships.length === 0) {
    const isAdmin = await queryClient.fetchQuery(amPlatformAdminQuery(user.id))
    throw redirect(isAdmin ? '/admin' : '/onboarding')
  }
  const last = lastTeam()
  const target = memberships.find((m) => m.team.slug === last) ?? memberships[0]
  throw redirect(startPath(target.team.slug))
}

/**
 * /onboarding: open to everyone signed in (new users, and existing users adding a team), except the
 * platform admin, which belongs to no group and goes to its console.
 */
export async function onboardingLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const [, isAdmin] = await Promise.all([
    queryClient.ensureQueryData(myTeamsQuery(user.id)),
    queryClient.ensureQueryData(amPlatformAdminQuery(user.id)),
  ])
  if (isAdmin) throw redirect('/admin')
  return null
}

/**
 * /t/:teamSlug: must be a member; primes workspaces for the sidebar and home page, and starts the rest
 * of the shell's group data (Starred, saved views, unread counts, the bell) in the same round instead
 * of after the sidebar has mounted. Only the workspace list and roles are awaited.
 */
export async function teamLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const memberships = await queryClient.ensureQueryData(myTeamsQuery(user.id))
  const membership = memberships.find((m) => m.team.slug === params.teamSlug)
  if (!membership) throw data('Group not found, or you’re not a member.', { status: 404 })

  rememberTeam(membership.team.slug)
  const team = membership.team.id
  void queryClient.prefetchQuery(teamPinsQuery(team))
  void queryClient.prefetchQuery(teamViewsQuery(team))
  void queryClient.prefetchQuery(unreadCountsQuery(team))
  void queryClient.prefetchQuery(notificationsQuery(team, user.id))
  await Promise.all([
    queryClient.ensureQueryData(teamWorkspacesQuery(membership.team.id)),
    queryClient.ensureQueryData(myWorkspaceRolesQuery(membership.team.id, user.id)),
  ])
  return null
}

/** /t/:teamSlug/w/:workspaceId: visible to team owners/admins and workspace members (RLS). */
export async function workspaceLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  // The header's people (most tabs read them too) start beside the workspace, not after the layout renders.
  void queryClient.prefetchQuery(workspaceMembersQuery(params.workspaceId ?? ''))
  const [memberships, workspace] = await Promise.all([
    queryClient.ensureQueryData(myTeamsQuery(user.id)),
    queryClient.ensureQueryData(workspaceQuery(params.workspaceId ?? '')),
  ])
  const team = memberships.find((m) => m.team.slug === params.teamSlug)?.team
  if (!workspace || !team || workspace.team_id !== team.id) {
    throw data('Workspace not found, or you don’t have access to it.', { status: 404 })
  }
  return null
}

/** /t/:teamSlug/members: the people and (for owners/admins) the invite codes, side by side. */
export async function teamMembersLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const memberships = await queryClient.ensureQueryData(myTeamsQuery(user.id))
  const membership = memberships.find((m) => m.team.slug === params.teamSlug)
  if (!membership) return null
  const isAdmin = membership.role === 'owner' || membership.role === 'admin'
  void queryClient.prefetchQuery(teamMembersQuery(membership.team.id))
  if (isAdmin) void queryClient.prefetchQuery(invitesQuery(membership.team.id))
  return null
}

/**
 * /t/:teamSlug/start: after sign-in or a group switch, use the account's saved destination when available.
 * Collection switches keep their existing automatic landing behavior and don't read the preference.
 */
export async function teamStartLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const memberships = await queryClient.ensureQueryData(myTeamsQuery(user.id))
  const membership = memberships.find((m) => m.team.slug === params.teamSlug)
  if (!membership) throw data('Group not found, or you’re not a member.', { status: 404 })
  const { team } = membership
  const collectionSwitch = new URL(request.url).searchParams.get('collection') === '1'
  const [contents, preference] = await Promise.all([
    queryClient.ensureQueryData(teamContentsQuery(team.id)),
    collectionSwitch
      ? Promise.resolve(null)
      : queryClient.fetchQuery({ ...starterPagePreferenceQuery(user.id, team.id), staleTime: 0 }),
  ])
  const { workspaces, collections } = contents
  const isAdmin = membership.role === 'owner' || membership.role === 'admin'
  const collection = pickCollection(availableCollections(collections, workspaces, user.id, isAdmin), readCollectionView(team.id), user.id)
  throw redirect(
    collectionSwitch
      ? landingPath(team.slug, team.type, collection, workspaces, readRecentVisits(team.id))
      : starterPagePath(team.slug, team.type, collection, workspaces, readRecentVisits(team.id), preference),
  )
}
