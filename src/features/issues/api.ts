import { queryOptions } from '@tanstack/react-query'
import { callGitHub, type Repo } from '@/features/repos/api'
import type { PersonProfile } from '@/features/teams/api'
import type { CycleEvent, HistoryIssue } from './cycleStats'
import { requireAffected, toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ISSUE_ERROR_EMBED, toIssueError, type IssueError } from '@/features/errors/embed'
import type { Database, Json, TablesInsert } from '@/types/database.types'
import { issueImagePaths, removeIssueImages } from './images'

// Issues live in one workspace. Anyone who can see the workspace can create
// and edit them; leads and team owners/admins delete issues and manage labels.
// RLS enforces all of it; see the create_issues migration.

export type IssueStatus = Database['public']['Enums']['issue_status']
/** Linear's scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export type IssuePriority = 0 | 1 | 2 | 3 | 4
export type LabelColor = 'default' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'pink' | 'violet'

export type Issue = {
  id: string
  workspace_id: string
  number: number
  title: string
  status: IssueStatus
  priority: IssuePriority
  assignee_id: string | null
  /** Imported issues only: the assignee as the file named them, until someone in Calsko is matched. */
  import_assignee: string | null
  /** The plan (a goal in the group) this issue is part of, or null. */
  plan_id: string | null
  parent_id: string | null
  cycle_id: string | null
  /** A repo linked to the workspace (like a label), or null. */
  repo_id: string | null
  estimate: number | null
  due_date: string | null
  completed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  labelIds: string[]
}
/** One issue with its description and creator. */
/** `error`: the error tracker's error this issue was made for (features/errors), or null. */
export type IssueDetail = Issue & { description: Json | null; creator: PersonProfile; error: IssueError | null }

/** A Linear-style cycle (sprint). Dates are local calendar dates ("YYYY-MM-DD"). */
export type IssueCycle = {
  id: string
  workspace_id: string
  number: number
  name: string | null
  starts_on: string
  ends_on: string
}

export type ActivityKind =
  | 'created'
  | 'title'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'parent'
  | 'cycle'
  | 'estimate'
  | 'due_date'
  | 'label_added'
  | 'label_removed'
  | 'repo'
  | 'pr_linked'
  | 'pr_merged'
  | 'pr_closed'
  | 'branch_created'

/** One change to an issue, written by a database trigger. Values are text (ids for assignee/parent/cycle/repo). */
export type IssueActivity = {
  id: number
  kind: ActivityKind
  from_value: string | null
  to_value: string | null
  actor_id: string | null
  /** 'github' when the change came from a GitHub webhook, 'errors' from error tracking (no actor). */
  via: 'github' | 'errors' | null
  created_at: string
  actor: PersonProfile
}

export type IssueLabel = { id: string; workspace_id: string; name: string; color: LabelColor }
export type IssueComment = {
  id: string
  issue_id: string
  body: string
  author_id: string | null
  created_at: string
  updated_at: string
  author: PersonProfile
}

/** Fields the UI can change on an existing issue (column grants allow exactly these). */
export type IssuePatch = Partial<
  Pick<Issue, 'title' | 'status' | 'priority' | 'assignee_id' | 'parent_id' | 'cycle_id' | 'repo_id' | 'estimate' | 'due_date' | 'plan_id'> & {
    description: Json | null
  }
>

const ISSUE_COLUMNS =
  'id, workspace_id, number, title, status, priority, assignee_id, import_assignee, plan_id, parent_id, cycle_id, repo_id, estimate, due_date, completed_at, created_by, created_at, updated_at, issue_label_links(label_id)'

type IssueRow = Omit<Issue, 'labelIds' | 'priority'> & { priority: number; issue_label_links: { label_id: string }[] }

function toIssue({ issue_label_links, priority, ...row }: IssueRow): Issue {
  return { ...row, priority: priority as IssuePriority, labelIds: issue_label_links.map((l) => l.label_id) }
}

const writeErrors = {
  '42501': 'You don’t have permission to change issues here.',
  '23514':
    'That change isn’t allowed. Assignees and repositories must belong to this workspace, and an issue can’t be its own sub-issue.',
  // private.check_issue: the issue's repo is connected to GitHub.
  DD001: 'In Review and Done are set by GitHub: open a pull request, then merge it. A lead can override.',
}

// ---------------------------------------------------------------- queries

export const issueKeys = {
  cycleHistory: (workspaceId: string, cycleId: string) => ['issues', 'cycle-history', workspaceId, cycleId] as const,
  all: ['issues'] as const,
  workspace: (workspaceId: string) => ['issues', 'workspace', workspaceId] as const,
  detail: (workspaceId: string, number: number) => ['issues', 'detail', workspaceId, number] as const,
  labels: (workspaceId: string) => ['issues', 'labels', workspaceId] as const,
  comments: (issueId: string) => ['issues', 'comments', issueId] as const,
  activity: (issueId: string) => ['issues', 'activity', issueId] as const,
  cycles: (workspaceId: string) => ['issues', 'cycles', workspaceId] as const,
  pullRequests: (issueId: string) => ['issues', 'pull-requests', issueId] as const,
  branches: (issueId: string) => ['issues', 'branches', issueId] as const,
}

/** Every issue in the workspace (small teams: one query, grouped and filtered client-side). */
export const workspaceIssuesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: issueKeys.workspace(workspaceId),
    queryFn: async (): Promise<Issue[]> => {
      const { data, error } = await supabase
        .from('issues')
        .select(ISSUE_COLUMNS)
        .eq('workspace_id', workspaceId)
        .order('number', { ascending: false })
      if (error) throw toDataError('load issues', error)
      return data.map(toIssue)
    },
  })

/**
 * An issue for the group-wide Issues page, with what its row shows from its project
 * (sprint, labels, the project's repos), so the page draws project-style rows from one request.
 */
export type TeamIssue = Issue & {
  workspace: { id: string; title: string; issue_key: string; repos: (Repo & { base_branch: string | null })[] }
  assignee: PersonProfile
  cycle: IssueCycle | null
  labels: IssueLabel[]
}

// Written out (not built from ISSUE_COLUMNS) so the typed client can read it.
const TEAM_ISSUE_COLUMNS =
  'id, workspace_id, number, title, status, priority, assignee_id, import_assignee, plan_id, parent_id, cycle_id, repo_id, estimate, due_date, completed_at, created_by, created_at, updated_at, issue_label_links(label_id, label:issue_labels!issue_label_links_label_fkey(id, workspace_id, name, color)), workspace:workspaces!issues_workspace_team_fkey(id, title, issue_key, workspace_repos(base_branch, repo:repos!workspace_repos_repo_fkey(id, team_id, owner, name, created_at, github_repo_id, installation_id))), assignee:profiles!issues_assignee_id_fkey(display_name, avatar_url), cycle:issue_cycles!issues_cycle_id_fkey(id, workspace_id, number, name, starts_on, ends_on)'

/** Issues from every workspace in the group the caller can see (RLS). */
export const teamIssuesQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['issues', 'team', teamId],
    queryFn: async (): Promise<TeamIssue[]> => {
      const { data, error } = await supabase
        .from('issues')
        .select(TEAM_ISSUE_COLUMNS)
        .eq('team_id', teamId)
        .order('updated_at', { ascending: false })
      if (error) throw toDataError('load issues', error)
      return data.map(({ workspace, assignee, cycle, ...row }) => ({
        ...toIssue(row),
        workspace: {
          id: workspace.id,
          title: workspace.title,
          issue_key: workspace.issue_key,
          repos: workspace.workspace_repos
            .map(({ repo, base_branch }) => ({ ...repo, base_branch }))
            .sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`, undefined, { sensitivity: 'base' })),
        },
        assignee,
        cycle,
        labels: row.issue_label_links.map((link) => link.label as IssueLabel),
      }))
    },
  })

/** null when the issue doesn't exist or the caller can't see it. */
export const issueQuery = (workspaceId: string, number: number) =>
  queryOptions({
    queryKey: issueKeys.detail(workspaceId, number),
    queryFn: async (): Promise<IssueDetail | null> => {
      const { data, error } = await supabase
        .from('issues')
        .select(`${ISSUE_COLUMNS}, description, creator:profiles!issues_created_by_fkey(display_name, avatar_url), ${ISSUE_ERROR_EMBED}`)
        .eq('workspace_id', workspaceId)
        .eq('number', number)
        .maybeSingle()
      if (error) throw toDataError('load the issue', error)
      if (!data) return null
      const { description, creator, error: issueError, ...row } = data
      return { ...toIssue(row), description, creator, error: toIssueError(issueError) }
    },
  })

export const labelsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: issueKeys.labels(workspaceId),
    queryFn: async (): Promise<IssueLabel[]> => {
      const { data, error } = await supabase
        .from('issue_labels')
        .select('id, workspace_id, name, color')
        .eq('workspace_id', workspaceId)
        .order('name')
      if (error) throw toDataError('load labels', error)
      return data as IssueLabel[]
    },
  })

/** Oldest first. */
export const cyclesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: issueKeys.cycles(workspaceId),
    queryFn: async (): Promise<IssueCycle[]> => {
      const { data, error } = await supabase
        .from('issue_cycles')
        .select('id, workspace_id, number, name, starts_on, ends_on')
        .eq('workspace_id', workspaceId)
        .order('starts_on')
      if (error) throw toDataError('load sprints', error)
      return data
    },
  })

/**
 * The sprints of several projects in one request (the Issues hub's Sprints tab). Under the cycles
 * prefix, so issue_cycles events refresh it.
 */
export const projectsCyclesQuery = (workspaceIds: string[]) =>
  queryOptions({
    queryKey: ['issues', 'cycles', 'projects', [...workspaceIds].sort().join(',')] as const,
    queryFn: async (): Promise<IssueCycle[]> => {
      if (workspaceIds.length === 0) return []
      const { data, error } = await supabase
        .from('issue_cycles')
        .select('id, workspace_id, number, name, starts_on, ends_on')
        .in('workspace_id', workspaceIds)
        .order('starts_on')
      if (error) throw toDataError('load sprints', error)
      return data
    },
  })

export const activityQuery = (issueId: string) =>
  queryOptions({
    queryKey: issueKeys.activity(issueId),
    queryFn: async (): Promise<IssueActivity[]> => {
      const { data, error } = await supabase
        .from('issue_activity')
        .select('id, kind, from_value, to_value, actor_id, via, created_at, actor:profiles!issue_activity_actor_id_fkey(display_name, avatar_url)')
        .eq('issue_id', issueId)
        .order('created_at')
        .order('id')
      if (error) throw toDataError('load the activity', error)
      return data as IssueActivity[]
    },
  })

/** A GitHub PR that mentions the issue; written only by the github-webhook Edge Function. */
export type IssuePullRequest = {
  id: string
  number: number
  title: string
  url: string
  state: 'draft' | 'open' | 'merged' | 'closed'
  head_ref: string
  /** For merged PRs: the branch the work has reached so far (it moves on when that branch is merged). */
  landed_ref: string | null
  author_login: string | null
  updated_at: string
  repo: { owner: string; name: string } | null
}

/** Open ones first, then newest. */
export const pullRequestsQuery = (issueId: string) =>
  queryOptions({
    queryKey: issueKeys.pullRequests(issueId),
    queryFn: async (): Promise<IssuePullRequest[]> => {
      const { data, error } = await supabase
        .from('issue_pull_requests')
        .select('id, number, title, url, state, head_ref, landed_ref, author_login, updated_at, repo:repos(owner, name)')
        .eq('issue_id', issueId)
        .order('updated_at', { ascending: false })
      if (error) throw toDataError('load pull requests', error)
      const rank = (s: IssuePullRequest['state']) => (s === 'open' || s === 'draft' ? 0 : 1)
      return (data as IssuePullRequest[]).sort((a, b) => rank(a.state) - rank(b.state))
    },
  })

/** A branch Calsko created (or adopted) on GitHub for the issue. */
export type IssueBranch = {
  id: string
  name: string
  base: string
  created_at: string
  repo: { owner: string; name: string } | null
}

export const issueBranchesQuery = (issueId: string) =>
  queryOptions({
    queryKey: issueKeys.branches(issueId),
    queryFn: async (): Promise<IssueBranch[]> => {
      const { data, error } = await supabase
        .from('issue_branches')
        .select('id, name, base, created_at, repo:repos(owner, name)')
        .eq('issue_id', issueId)
        .order('created_at')
      if (error) throw toDataError('load branches', error)
      return data
    },
  })

/**
 * Creates the issue's branch on GitHub (the `github` Edge Function), in its
 * repo or the project's only repo. Returns the existing one if it has one.
 */
export const createIssueBranch = (issueId: string) =>
  callGitHub<{ branch: { name: string; base: string }; created: boolean }>('create_branch', { issueId })

export const commentsQuery = (issueId: string) =>
  queryOptions({
    queryKey: issueKeys.comments(issueId),
    queryFn: async (): Promise<IssueComment[]> => {
      const { data, error } = await supabase
        .from('issue_comments')
        .select('id, issue_id, body, author_id, created_at, updated_at, author:profiles!issue_comments_author_id_fkey(display_name, avatar_url)')
        .eq('issue_id', issueId)
        .order('created_at')
      if (error) throw toDataError('load comments', error)
      return data
    },
  })

// -------------------------------------------------------------- mutations

export type NewIssue = {
  workspaceId: string
  title: string
  description?: Json | null
  status?: IssueStatus
  priority?: IssuePriority
  assigneeId?: string | null
  parentId?: string | null
  cycleId?: string | null
  repoId?: string | null
  planId?: string | null
  labelIds?: string[]
}

/** number, team_id and created_by are set by the database. */
export async function createIssue(input: NewIssue): Promise<{ id: string; number: number }> {
  const row: Omit<TablesInsert<'issues'>, 'team_id' | 'number'> = {
    workspace_id: input.workspaceId,
    title: input.title.trim(),
    description: input.description ?? null,
    status: input.status ?? 'todo',
    priority: input.priority ?? 0,
    assignee_id: input.assigneeId ?? null,
    parent_id: input.parentId ?? null,
    cycle_id: input.cycleId ?? null,
    repo_id: input.repoId ?? null,
    plan_id: input.planId ?? null,
  }
  // Generated types can't see the insert trigger that fills team_id and number.
  const { data, error } = await supabase
    .from('issues')
    .insert(row as TablesInsert<'issues'>)
    .select('id, number')
    .single()
  if (error) throw toDataError('create the issue', error, writeErrors)
  if (input.labelIds?.length) await setIssueLabels(data.id, input.labelIds)
  return data
}

export async function updateIssue(issueId: string, patch: IssuePatch) {
  const update = patch.title === undefined ? patch : { ...patch, title: patch.title.trim() }
  const { data, error } = await supabase.from('issues').update(update).eq('id', issueId).select('id, updated_at')
  if (error) throw toDataError('save the issue', error, writeErrors)
  requireAffected(data, 'update issue')
  // The time the database gave this save: it identifies our own echo (lib/realtime `ownSave`).
  return data[0]?.updated_at
}

/** Replaces the issue's labels atomically (RPC, runs under RLS). */
export async function setIssueLabels(issueId: string, labelIds: string[]) {
  const { error } = await supabase.rpc('set_issue_labels', { p_issue_id: issueId, p_label_ids: labelIds })
  if (error) throw toDataError('save the labels', error, writeErrors)
}

/** Sub-issues are kept and become top-level (parent_id → null). The description's images are removed too. */
export async function deleteIssue(issueId: string) {
  const { data, error } = await supabase.from('issues').delete().eq('id', issueId).select('id, description')
  if (error) throw toDataError('delete the issue', error)
  const [deleted] = requireAffected(data, 'delete issue')
  await removeIssueImages(issueImagePaths(deleted.description))
}

const labelErrors = {
  '42501': 'Only workspace leads and group owners/admins can manage labels.',
  '23505': 'A label with that name already exists.',
}

export async function createLabel(workspaceId: string, name: string, color: LabelColor): Promise<IssueLabel> {
  const { data, error } = await supabase
    .from('issue_labels')
    .insert({ workspace_id: workspaceId, name: name.trim(), color })
    .select('id, workspace_id, name, color')
    .single()
  if (error) throw toDataError('create the label', error, labelErrors)
  return data as IssueLabel
}

export async function updateLabel(labelId: string, input: { name: string; color: LabelColor }) {
  const { data, error } = await supabase
    .from('issue_labels')
    .update({ name: input.name.trim(), color: input.color })
    .eq('id', labelId)
    .select('id')
  if (error) throw toDataError('save the label', error, labelErrors)
  requireAffected(data, 'update label')
}

export async function deleteLabel(labelId: string) {
  const { data, error } = await supabase.from('issue_labels').delete().eq('id', labelId).select('id')
  if (error) throw toDataError('delete the label', error, labelErrors)
  requireAffected(data, 'delete label')
}

const cycleErrors = {
  '42501': 'Only workspace leads and group owners/admins can manage sprints.',
  '23P01': 'Those dates overlap another sprint.',
  '23514': 'The end date must be on or after the start date.',
}

export type CycleInput = { name: string; startsOn: string; endsOn: string }

/** The number is set by the database (next in the workspace). */
export async function createCycle(workspaceId: string, input: CycleInput) {
  const row = { workspace_id: workspaceId, name: input.name.trim() || null, starts_on: input.startsOn, ends_on: input.endsOn }
  // Generated types can't see the trigger that sets `number`.
  const { data, error } = await supabase
    .from('issue_cycles')
    .insert(row as TablesInsert<'issue_cycles'>)
    .select('id, number')
    .single()
  if (error) throw toDataError('create the sprint', error, cycleErrors)
  return data
}

export async function updateCycle(cycleId: string, input: CycleInput) {
  const { data, error } = await supabase
    .from('issue_cycles')
    .update({ name: input.name.trim() || null, starts_on: input.startsOn, ends_on: input.endsOn })
    .eq('id', cycleId)
    .select('id')
  if (error) throw toDataError('save the sprint', error, cycleErrors)
  requireAffected(data, 'update sprint')
}

/** Its issues are kept, without a cycle. */
export async function deleteCycle(cycleId: string) {
  const { data, error } = await supabase.from('issue_cycles').delete().eq('id', cycleId).select('id')
  if (error) throw toDataError('delete the sprint', error, cycleErrors)
  requireAffected(data, 'delete sprint')
}

/**
 * What a change to a cycle's issues can alter: the workspace's issue list, the
 * cycle charts and (after a delete) the pins that pointed at the cycle. The
 * group-wide list is only marked stale unless it's open. Labels, saved views,
 * comments and the other issues queries are untouched.
 */
export function cycleChangeKeys(workspaceId: string) {
  return [issueKeys.cycles(workspaceId), issueKeys.workspace(workspaceId), ['issues', 'cycle-history', workspaceId], ['issues', 'pins'], ['issues', 'team']] as const
}

/** Moves a cycle's unfinished issues to another cycle (or out of cycles). Returns how many moved. */
export async function moveOpenIssues(fromCycleId: string, toCycleId: string | null): Promise<number> {
  // The function accepts null (out of cycles); generated RPC argument types are never nullable.
  const { data, error } = await supabase.rpc('move_open_issues', { p_from: fromCycleId, p_to: toCycleId as string })
  if (error) throw toDataError('move the issues', error, writeErrors)
  return data
}

export async function addComment(issueId: string, workspaceId: string, body: string) {
  const { error } = await supabase
    .from('issue_comments')
    .insert({ issue_id: issueId, workspace_id: workspaceId, body: body.trim() })
  if (error) throw toDataError('post the comment', error)
}

export async function updateComment(commentId: string, body: string) {
  const { data, error } = await supabase
    .from('issue_comments')
    .update({ body: body.trim() })
    .eq('id', commentId)
    .select('id')
  if (error) throw toDataError('save the comment', error)
  requireAffected(data, 'update comment')
}

export async function deleteComment(commentId: string) {
  const { data, error } = await supabase.from('issue_comments').delete().eq('id', commentId).select('id')
  if (error) throw toDataError('delete the comment', error)
  requireAffected(data, 'delete comment')
}

// ---------------------------------------------------------------- cycle history

const CHUNK = 100

/**
 * What the cycle's burn-up chart is built from: when each issue entered or left the cycle and when its
 * status changed, for the issues in the cycle now (`currentIds`) and the ones that were moved out of it.
 */
export const cycleHistoryQuery = (workspaceId: string, cycleId: string, currentIds: string[]) =>
  queryOptions({
    queryKey: issueKeys.cycleHistory(workspaceId, cycleId),
    queryFn: async (): Promise<{ events: CycleEvent[]; extra: HistoryIssue[] }> => {
      const { data: moves, error } = await supabase
        .from('issue_activity')
        .select('issue_id, kind, from_value, to_value, created_at')
        .eq('workspace_id', workspaceId)
        .eq('kind', 'cycle')
        .or(`from_value.eq.${cycleId},to_value.eq.${cycleId}`)
      if (error) throw toDataError('load the sprint history', error)
      const ids = [...new Set([...moves.map((m) => m.issue_id), ...currentIds])]
      const events: CycleEvent[] = moves.map((m) => ({ ...m, kind: 'cycle' as const }))
      const extraIds = ids.filter((id) => !currentIds.includes(id))
      const extra: HistoryIssue[] = []
      // Long lists of ids are fetched in chunks (they travel in the URL).
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const { data, error: statusError } = await supabase
          .from('issue_activity')
          .select('issue_id, kind, from_value, to_value, created_at')
          .eq('kind', 'status')
          .in('issue_id', chunk)
        if (statusError) throw toDataError('load the sprint history', statusError)
        events.push(...data.map((m) => ({ ...m, kind: 'status' as const })))
      }
      for (let i = 0; i < extraIds.length; i += CHUNK) {
        const { data, error: issueError } = await supabase
          .from('issues')
          .select('id, created_at, estimate, status')
          .in('id', extraIds.slice(i, i + CHUNK))
        if (issueError) throw toDataError('load the sprint history', issueError)
        extra.push(...(data as HistoryIssue[]))
      }
      return { events, extra }
    },
  })
