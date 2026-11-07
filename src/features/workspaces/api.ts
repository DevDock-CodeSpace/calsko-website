import { queryOptions } from '@tanstack/react-query'
import type { PersonProfile } from '@/features/teams/api'
import { requireAffected, toDataError } from '@/lib/errors'
import { SETTLED_STALE_MS } from '@/lib/query-client'
import { supabase } from '@/lib/supabase'
import type { Database, Tables, TablesInsert } from '@/types/database.types'

export type WorkspaceRole = Database['public']['Enums']['workspace_role']
export type WorkspaceType = Database['public']['Enums']['workspace_type']
/** Workspace tools. 'resources' is retired in the database (Docs replaced it). */
export type WorkspaceModule = Exclude<Database['public']['Enums']['workspace_module'], 'resources'>
const isActiveModule = (module: Database['public']['Enums']['workspace_module']): module is WorkspaceModule =>
  module !== 'resources'
/** Who gets in besides the people added to it: nobody, its collection's people, or the whole group. */
export type WorkspaceAccess = Database['public']['Enums']['workspace_access']
export type Workspace = Pick<
  Tables<'workspaces'>,
  | 'id' | 'team_id' | 'title' | 'description' | 'type' | 'issue_key' | 'access' | 'collection_id' | 'enrollment'
  | 'published' | 'price_inr' | 'price_usd_cents' | 'created_at' | 'updated_at'
> & {
  /** Enabled tools; drives the workspace tabs. */
  modules: WorkspaceModule[]
}
export type WorkspaceSummary = Pick<
  Tables<'workspaces'>,
  'id' | 'title' | 'description' | 'type' | 'issue_key' | 'access' | 'collection_id' | 'updated_at'
> & {
  /** Enabled tools (used by the team-level tool pages). */
  modules: WorkspaceModule[]
  /** Everyone who can use it: the people added, plus whoever its access setting lets in. */
  memberCount: number
  leads: NonNullable<PersonProfile>[]
}
/** `via` says how they got in: added to it ('member'), or let in by its access setting. */
export type WorkspaceMember = {
  user_id: string
  role: WorkspaceRole
  joined_at: string
  via: 'member' | 'collection' | 'group'
  profile: PersonProfile
}
/** An optional set of workspaces inside a group, with its own people. */
export type Collection = Pick<Tables<'workspace_collections'>, 'id' | 'name' | 'type' | 'position'> & {
  memberIds: string[]
}
type TeamContents = { workspaces: WorkspaceSummary[]; collections: Collection[] }

// ---------------------------------------------------------------- queries

/**
 * A group's workspaces and collections in one request (they share a cache entry, so the shell asks
 * once). Rosters are small (a class or project group), so embedding them beats more queries.
 */
const teamContents = (teamId: string) => ({
  queryKey: ['workspaces', 'team', teamId] as const,
  staleTime: SETTLED_STALE_MS,
  queryFn: async (): Promise<TeamContents> => {
    const { data, error } = await supabase
      .from('teams')
      .select(
        `team_members(user_id),
         workspace_collections(id, name, type, position, workspace_collection_members(user_id)),
         workspaces(id, title, description, type, issue_key, access, collection_id, updated_at, workspace_modules(module),
           workspace_members(user_id, role, profile:profiles(display_name, avatar_url)))`,
      )
      .eq('id', teamId)
      .order('title', { referencedTable: 'workspaces' })
      .order('position', { referencedTable: 'workspace_collections' })
      .maybeSingle()
    if (error) throw toDataError('load workspaces', error)
    if (!data) return { workspaces: [], collections: [] }
    const collections = data.workspace_collections.map(({ workspace_collection_members, ...collection }) => ({
      ...collection,
      memberIds: workspace_collection_members.map((m) => m.user_id),
    }))
    const everyone = data.team_members.map((m) => m.user_id)
    const workspaces = data.workspaces.map(({ workspace_members, workspace_modules, ...workspace }) => {
      const letIn =
        workspace.access === 'group'
          ? everyone
          : workspace.access === 'collection'
            ? (collections.find((c) => c.id === workspace.collection_id)?.memberIds ?? [])
            : []
      return {
        ...workspace,
        modules: workspace_modules.map((m) => m.module).filter(isActiveModule),
        memberCount: new Set([...workspace_members.map((m) => m.user_id), ...letIn]).size,
        leads: workspace_members
          .filter((m) => m.role === 'lead')
          .map((m) => m.profile)
          .filter((p): p is NonNullable<PersonProfile> => p !== null),
      }
    })
    return { workspaces, collections }
  },
})
/** The raw entry behind both queries below, for loaders: `ensureQueryData` returns it without `select`. */
export const teamContentsQuery = (teamId: string) => teamContents(teamId)
const pickWorkspaces = (contents: TeamContents) => contents.workspaces
const pickCollections = (contents: TeamContents) => contents.collections

/** Workspaces visible to the caller: all of them for team owners/admins, otherwise the ones they're in (RLS). */
export const teamWorkspacesQuery = (teamId: string) => queryOptions({ ...teamContents(teamId), select: pickWorkspaces })

/** The group's collections, in order, with who is in each. Empty for most groups. */
export const teamCollectionsQuery = (teamId: string) => queryOptions({ ...teamContents(teamId), select: pickCollections })

/** The caller's role in each workspace of a team they're assigned to. */
export const myWorkspaceRolesQuery = (teamId: string, userId: string) =>
  queryOptions({
    queryKey: ['workspaces', 'team', teamId, 'my-roles', userId],
    staleTime: SETTLED_STALE_MS,
    queryFn: async (): Promise<Record<string, WorkspaceRole>> => {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('team_id', teamId)
        .eq('user_id', userId)
      if (error) throw toDataError('load your workspace roles', error)
      return Object.fromEntries(data.map((row) => [row.workspace_id, row.role]))
    },
  })

/** null when the workspace doesn't exist or the caller can't see it. */
export const workspaceQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId],
    queryFn: async (): Promise<Workspace | null> => {
      const { data, error } = await supabase
        .from('workspaces')
        .select('id, team_id, title, description, type, issue_key, access, collection_id, enrollment, published, price_inr, price_usd_cents, created_at, updated_at, workspace_modules(module)')
        .eq('id', workspaceId)
        .maybeSingle()
      if (error) throw toDataError('load the workspace', error)
      if (!data) return null
      const { workspace_modules, ...workspace } = data
      return { ...workspace, modules: workspace_modules.map((m) => m.module).filter(isActiveModule) }
    },
  })

/**
 * Everyone in the workspace: the people added to it, then whoever its access setting lets in
 * (`via`). One call (`workspace_people`), so open workspaces cost the same as closed ones.
 */
export const workspaceMembersQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ['workspaces', workspaceId, 'members'],
    queryFn: async (): Promise<WorkspaceMember[]> => {
      const { data, error } = await supabase.rpc('workspace_people', { p_workspace_id: workspaceId })
      if (error) throw toDataError('load workspace members', error)
      return data.map(({ display_name, avatar_url, via, ...person }) => ({
        ...person,
        via: via === 'group' || via === 'collection' ? via : 'member',
        profile: { display_name, avatar_url },
      }))
    },
  })

// -------------------------------------------------------------- mutations

type WorkspaceInput = { title: string; description: string; type: WorkspaceType }

/**
 * Creates the workspace with its tools, its collection and who can see it, in one transaction
 * (RPC; group owners and admins only).
 */
export async function createWorkspace(
  teamId: string,
  input: WorkspaceInput & { modules: WorkspaceModule[]; access: WorkspaceAccess; collectionId: string | null },
): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('create_workspace_in', {
    p_team_id: teamId,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_type: input.type,
    p_modules: input.modules,
    p_access: input.access,
    // The generated type marks every argument as required; the function accepts null here.
    p_collection_id: input.collectionId as string,
  })
  if (error) throw toDataError('create it', error, { '23514': 'Development groups can have projects and spaces, not courses.' })
  return { id: data }
}

/** Who gets in besides the people added to it. Group owners and admins only (checked by the RPC). */
export async function setWorkspaceAccess(workspaceId: string, access: WorkspaceAccess) {
  const { error } = await supabase.rpc('set_workspace_access', { p_workspace_id: workspaceId, p_access: access })
  if (error) throw toDataError('change who can see it', error, { '23514': 'Put it in a collection first.' })
}

/** Moves it into a collection, or out of any (null). Nobody loses or gains access by a move. */
export async function setWorkspaceCollection(workspaceId: string, collectionId: string | null) {
  const { error } = await supabase.rpc('set_workspace_collection', {
    p_workspace_id: workspaceId,
    p_collection_id: collectionId as string,
  })
  if (error) throw toDataError('move it', error, { '23503': 'That collection no longer exists.' })
}

/** Replaces the workspace's enabled tools (team owner/admin or workspace lead). */
export async function setWorkspaceModules(workspaceId: string, modules: WorkspaceModule[]) {
  const { error } = await supabase.rpc('set_workspace_modules', { p_workspace_id: workspaceId, p_modules: modules })
  if (error) throw toDataError('save the tools', error)
}

export async function updateWorkspace(workspaceId: string, input: WorkspaceInput) {
  const { data, error } = await supabase
    .from('workspaces')
    .update({ title: input.title.trim(), description: input.description.trim() || null, type: input.type })
    .eq('id', workspaceId)
    .select('id')
  if (error) throw toDataError('save it', error, { '23514': 'Development groups can have projects and spaces, not courses.' })
  requireAffected(data, 'update workspace')
}

/** The prefix of issue identifiers (CAP in CAP-12). Workspace managers only (RLS). */
export async function updateIssueKey(workspaceId: string, key: string) {
  const { data, error } = await supabase
    .from('workspaces')
    .update({ issue_key: key.trim().toUpperCase() })
    .eq('id', workspaceId)
    .select('id')
  if (error) {
    throw toDataError('save the issue key', error, {
      '23514': 'Use 2–6 letters or digits, starting with a letter (e.g. CAP).',
    })
  }
  requireAffected(data, 'update issue key')
}

export async function deleteWorkspace(workspaceId: string) {
  const { data, error } = await supabase.from('workspaces').delete().eq('id', workspaceId).select('id')
  if (error) throw toDataError('delete the workspace', error)
  requireAffected(data, 'delete workspace')
}

export async function addWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  // team_id is NOT NULL but always set by a DB trigger from the workspace (clients
  // have no INSERT privilege on it). Generated types can't see triggers, so omit it here.
  const row: Omit<TablesInsert<'workspace_members'>, 'team_id'> = { workspace_id: workspaceId, user_id: userId, role }
  const { error } = await supabase.from('workspace_members').insert(row as TablesInsert<'workspace_members'>)
  if (error) {
    throw toDataError('add the member', error, { '23505': 'They’re already in this workspace.' })
  }
}

export async function setWorkspaceRole(workspaceId: string, userId: string, role: WorkspaceRole) {
  const { data, error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw toDataError('change the role', error)
  requireAffected(data, 'change workspace role')
}

/** Remove someone, or leave (userId = yourself). */
export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  const { data, error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw toDataError('remove the member', error)
  requireAffected(data, 'remove workspace member')
}

// ------------------------------------------------------------------ pins
