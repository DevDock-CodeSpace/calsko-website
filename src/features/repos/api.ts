import { queryOptions } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { DataError, requireAffected, toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { logError } from '@/lib/error-tracking'

// GitHub repositories belong to the group and are linked to any number of its
// projects. Issues stay in their workspace and can point at one linked repo.
// Group owners/admins add and remove repos; workspace managers link and
// unlink them. RLS enforces it; see the repos_and_issue_repo migration.
//
// Connecting GitHub (the Calsko GitHub App) goes through the `github` Edge
// Function, which verifies with GitHub and is the only writer of
// github_installations and of a repo's GitHub id/installation.

export type Repo = {
  id: string
  team_id: string
  owner: string
  name: string
  created_at: string
  /** GitHub's id; null for a repo added by name only. */
  github_repo_id: number | null
  /** null = not reachable through a connected installation ("Not connected"). */
  installation_id: number | null
}
/** A group repo with the workspaces (that the caller can see) it's linked to. */
export type TeamRepo = Repo & { workspaceIds: string[] }

const REPO_COLUMNS = 'id, team_id, owner, name, created_at, github_repo_id, installation_id'

export const repoFullName = (repo: Pick<Repo, 'owner' | 'name'>) => `${repo.owner}/${repo.name}`
export const repoUrl = (repo: Pick<Repo, 'owner' | 'name'>) => `https://github.com/${repo.owner}/${repo.name}`

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const NAME = /^[A-Za-z0-9._-]{1,100}$/

/**
 * Reads "owner/name", a github.com URL (with or without .git, or a deeper
 * path like /pull/3) or an SSH remote. null when it isn't a GitHub repo.
 */
export function parseRepo(input: string): { owner: string; name: string } | null {
  const text = input.trim()
  const match =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i.exec(text) ??
    /^git@github\.com:([^/\s]+)\/([^/\s]+)$/i.exec(text) ??
    /^([^/\s:]+)\/([^/\s]+)$/.exec(text)
  if (!match) return null
  const owner = match[1]
  const name = match[2].replace(/\.git$/i, '')
  return OWNER.test(owner) && NAME.test(name) && name !== '.' && name !== '..' ? { owner, name } : null
}

export const repoKeys = {
  all: ['repos'] as const,
  team: (teamId: string) => ['repos', 'team', teamId] as const,
  workspace: (workspaceId: string) => ['repos', 'workspace', workspaceId] as const,
  installations: (teamId: string) => ['repos', 'installations', teamId] as const,
  github: (teamId: string) => ['repos', 'github', teamId] as const,
}

/** Every repo in the group, A–Z, with the workspaces it's linked to. */
export const teamReposQuery = (teamId: string) =>
  queryOptions({
    queryKey: repoKeys.team(teamId),
    queryFn: async (): Promise<TeamRepo[]> => {
      const { data, error } = await supabase
        .from('repos')
        .select(`${REPO_COLUMNS}, workspace_repos(workspace_id)`)
        .eq('team_id', teamId)
        .order('owner')
        .order('name')
      if (error) throw toDataError('load repositories', error)
      return data.map(({ workspace_repos, ...repo }) => ({
        ...repo,
        workspaceIds: workspace_repos.map((l) => l.workspace_id),
      }))
    },
  })

/**
 * A repo as linked to one workspace, with that project's branch settings:
 * new issue branches start from `base_branch` (null = no base selected), and
 * merging into one of `done_branches` marks issues Done (empty = the default).
 */
export type LinkedRepo = Repo & { base_branch: string | null; done_branches: string[] }

/** The repos linked to one workspace, A–Z. */
export const workspaceReposQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: repoKeys.workspace(workspaceId),
    queryFn: async (): Promise<LinkedRepo[]> => {
      const { data, error } = await supabase
        .from('workspace_repos')
        .select(`base_branch, done_branches, repo:repos!workspace_repos_repo_fkey(${REPO_COLUMNS})`)
        .eq('workspace_id', workspaceId)
      if (error) throw toDataError('load repositories', error)
      return data
        .map(({ repo, base_branch, done_branches }) => ({ ...repo, base_branch, done_branches }))
        .sort((a, b) => repoFullName(a).localeCompare(repoFullName(b), undefined, { sensitivity: 'base' }))
    },
  })

/** A project's branch settings for one linked repo (workspace managers). */
export async function updateRepoBranches(
  workspaceId: string,
  repoId: string,
  settings: { baseBranch: string | null; doneBranches: string[] },
) {
  const { data, error } = await supabase
    .from('workspace_repos')
    .update({ base_branch: settings.baseBranch, done_branches: settings.doneBranches })
    .eq('workspace_id', workspaceId)
    .eq('repo_id', repoId)
    .select('repo_id')
  if (error) {
    throw toDataError('save the branch settings', error, {
      '42501': 'Only leads and group owners/admins can change branch settings.',
      '23514': 'Branch names can’t contain spaces or ~^:?*[\\ (up to 10 done branches).',
    })
  }
  requireAffected(data, 'update repo branches')
}

const repoErrors = {
  '42501': 'Only group owners and admins can add or remove repositories.',
  '23505': 'That repository is already in this group.',
  '23514': 'That isn’t a valid GitHub repository name.',
}

const linkErrors = {
  '42501': 'Only leads and group owners/admins can link repositories.',
  '23505': 'That repository is already linked here.',
}

export async function createRepo(teamId: string, repo: { owner: string; name: string }): Promise<Repo> {
  const { data, error } = await supabase
    .from('repos')
    .insert({ team_id: teamId, owner: repo.owner, name: repo.name })
    .select(REPO_COLUMNS)
    .single()
  if (error) throw toDataError('add the repository', error, repoErrors)
  return data
}

/** Also unlinks it everywhere; issues that pointed at it keep going, without a repo. */
export async function deleteRepo(repoId: string) {
  const { data, error } = await supabase.from('repos').delete().eq('id', repoId).select('id')
  if (error) throw toDataError('remove the repository', error, repoErrors)
  requireAffected(data, 'delete repo')
}

export async function linkRepo(input: { teamId: string; workspaceId: string; repoId: string }) {
  const { error } = await supabase
    .from('workspace_repos')
    .insert({ team_id: input.teamId, workspace_id: input.workspaceId, repo_id: input.repoId })
  if (error) throw toDataError('link the repository', error, linkErrors)
}

/** The workspace's issues that pointed at it lose their repo (a DB trigger). */
export async function unlinkRepo(workspaceId: string, repoId: string) {
  const { data, error } = await supabase
    .from('workspace_repos')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('repo_id', repoId)
    .select('repo_id')
  if (error) throw toDataError('unlink the repository', error, linkErrors)
  requireAffected(data, 'unlink repo')
}

// ------------------------------------------------------------------ GitHub App

export type GitHubInstallation = {
  installation_id: number
  account_login: string
  account_type: 'User' | 'Organization'
  created_at: string
}
/** A repo the group's installations can reach (from GitHub, not yet necessarily in Calsko). */
export type GitHubRepo = { githubRepoId: number; owner: string; name: string; private: boolean }

/** The App's public slug (github.com/apps/<slug>); unset = GitHub isn't set up for this deployment. */
export const githubAppSlug = import.meta.env.VITE_GITHUB_APP_SLUG || null

/** Where to manage an installation (repo access, uninstall) on GitHub. */
export const installationSettingsUrl = (i: Pick<GitHubInstallation, 'installation_id' | 'account_login' | 'account_type'>) =>
  i.account_type === 'Organization'
    ? `https://github.com/organizations/${i.account_login}/settings/installations/${i.installation_id}`
    : `https://github.com/settings/installations/${i.installation_id}`

export const githubInstallationsQuery = (teamId: string) =>
  queryOptions({
    queryKey: repoKeys.installations(teamId),
    queryFn: async (): Promise<GitHubInstallation[]> => {
      const { data, error } = await supabase
        .from('github_installations')
        .select('installation_id, account_login, account_type, created_at')
        .eq('team_id', teamId)
        .order('created_at')
      if (error) throw toDataError('load the GitHub connection', error)
      return data as GitHubInstallation[]
    },
  })

const githubErrors: Record<string, string> = {
  not_configured: 'GitHub isn’t set up for Calsko yet. Ask whoever runs Calsko to add the GitHub App keys.',
  unauthorized: 'Your session expired. Sign in again and retry.',
  forbidden: 'Only group owners and admins can do that.',
  state_invalid: 'That GitHub link expired or was already used. Start again from Group settings.',
  installation_denied: 'Your GitHub account can’t access that installation, so it wasn’t connected.',
  repo_not_found: 'The Calsko GitHub App can’t see that repository. Give it access on GitHub first.',
  not_found: 'That no longer exists, or you don’t have access to it.',
  no_repo: 'Set the issue’s repository first (this project has several).',
  repo_not_connected: 'That repository isn’t connected to GitHub. Add it from GitHub in Group settings → Repositories.',
  base_branch_unset: 'Choose a base branch in this project’s GitHub settings before creating issue branches.',
  base_missing: 'The project’s base branch doesn’t exist on GitHub. Check the branch settings on the GitHub tab.',
  github_error: 'GitHub didn’t respond as expected. Please try again.',
}

/** Calls the `github` Edge Function, turning its error codes into friendly messages. */
export async function callGitHub<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('github', { body: { action, ...body } })
  if (error || !data) {
    let code: string | undefined
    if (error instanceof FunctionsHttpError) {
      code = await (error.context as Response)
        .json()
        .then((b: { error?: string }) => b.error)
        .catch(() => undefined)
    }
    logError(`[github] ${action} failed`, code ?? error)
    throw new DataError((code && githubErrors[code]) ?? 'Something went wrong talking to GitHub. Please try again.', code, {
      cause: error,
    })
  }
  return data
}

/** Set in the tab `startGitHubConnect` opens, so /github/callback knows it can say "close this tab". */
export const GITHUB_CONNECT_TAB_KEY = 'devdock:githubConnectTab'
/** /github/callback tells the group's other tabs that an install was connected. */
export const GITHUB_CONNECT_CHANNEL = 'devdock:github'

/** GitHub's page for installing the App on an account, carrying the connect state back. */
export const githubInstallUrl = (state: string) =>
  `https://github.com/apps/${githubAppSlug}/installations/new?state=${encodeURIComponent(state)}`

/**
 * Sends a group owner/admin to GitHub in a new tab, so Calsko stays open. It starts with GitHub
 * sign-in, which always returns to /github/callback; the install page alone stays on GitHub when
 * the App is already installed on the account, and the group never got connected.
 */
export async function startGitHubConnect(teamId: string) {
  if (!githubAppSlug) throw new DataError(githubErrors.not_configured, 'not_configured')
  // Opened before the request, while the click still counts (pop-up blockers). Same origin and
  // with an opener, so it gets a copy of this tab's sessionStorage, and with it the session.
  const tab = window.open('', '_blank')
  let authorizeUrl: string
  try {
    ;({ authorizeUrl } = await callGitHub<{ state: string; authorizeUrl: string }>('start', { teamId }))
  } catch (error) {
    tab?.close()
    throw error
  }
  if (!tab) return window.location.assign(authorizeUrl) // pop-ups blocked: this tab goes instead
  tab.sessionStorage.setItem(GITHUB_CONNECT_TAB_KEY, '1')
  tab.opener = null
  tab.location.assign(authorizeUrl)
}

export type GitHubAccountChoice = { installationId: number; account: string; type: 'User' | 'Organization' }

export type GitHubConnectResult =
  | { kind: 'connected'; teamSlug: string; account: string }
  /** Installations the person can reach that the group lacks (none: `install`), and the accounts it already has. */
  | { kind: 'choose'; teamSlug: string; accounts: GitHubAccountChoice[]; connected: string[] }
  | { kind: 'install'; teamSlug: string; accounts: []; connected: string[] }

/**
 * Back from GitHub (the Edge Function verifies everything with GitHub): `code` from sign-in,
 * plus `installationId` after a new install; `installationId` alone is a pick from `choose`.
 */
export const connectGitHub = (input: { state: string; code?: string; installationId?: number }) =>
  callGitHub<GitHubConnectResult>('connect', input)

/** Tells the group's other tabs to refetch. True in the tab `startGitHubConnect` opened, which can be closed. */
export function announceGitHubConnected() {
  const channel = new BroadcastChannel(GITHUB_CONNECT_CHANNEL)
  channel.postMessage('connected')
  channel.close()
  const opened = sessionStorage.getItem(GITHUB_CONNECT_TAB_KEY) !== null
  sessionStorage.removeItem(GITHUB_CONNECT_TAB_KEY)
  return opened
}

/** Repos the group's installations can reach, for owners/admins to add. */
export const githubReposQuery = (teamId: string) =>
  queryOptions({
    queryKey: repoKeys.github(teamId),
    queryFn: async () => (await callGitHub<{ repos: GitHubRepo[] }>('repos', { teamId })).repos,
    staleTime: 30_000,
    // Asked again on coming back from GitHub (repo access is granted in another tab), however recent.
    refetchOnWindowFocus: 'always',
  })

/** Adds a GitHub repo to the group (or connects the one added earlier by name). */
export const addGitHubRepo = async (teamId: string, githubRepoId: number) =>
  (await callGitHub<{ repo: Repo }>('add_repo', { teamId, githubRepoId })).repo

/** Forgets the connection in Calsko; repos stay, marked not connected. The App stays installed on GitHub. */
export async function disconnectGitHub(teamId: string, installationId: number) {
  const { data, error } = await supabase
    .from('github_installations')
    .delete()
    .eq('team_id', teamId)
    .eq('installation_id', installationId)
    .select('installation_id')
  if (error) throw toDataError('disconnect GitHub', error, { '42501': githubErrors.forbidden })
  requireAffected(data, 'disconnect github')
}

/** A connected repo's branches (for choosing base and done branches). */
export const repoBranchesQuery = (repoId: string) =>
  queryOptions({
    queryKey: ['repos', 'branches', repoId] as const,
    queryFn: () => callGitHub<{ defaultBranch: string; branches: string[] }>('branches', { repoId }),
    staleTime: 30_000,
  })
