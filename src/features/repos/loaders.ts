import { redirect, type LoaderFunctionArgs } from 'react-router'
import { requireUser } from '@/features/auth/loaders'
import { errorMessage } from '@/lib/errors'
import { queryClient } from '@/lib/query-client'
import { workspaceIssuesQuery } from '@/features/issues/api'
import { myTeamsQuery } from '@/features/teams/api'
import { workspaceQuery } from '@/features/workspaces/api'
import {
  announceGitHubConnected,
  connectGitHub,
  githubInstallationsQuery,
  githubInstallUrl,
  repoKeys,
  teamReposQuery,
  workspaceReposQuery,
  type GitHubAccountChoice,
} from './api'

/**
 * …/w/:workspaceId/github: the project's repos, the group's, the GitHub install and (with the Issues tool)
 * the issues for the counts, all at once. They used to start one after another as the page rendered.
 */
export async function githubTabLoader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const workspaceId = params.workspaceId ?? ''
  void queryClient.prefetchQuery(workspaceReposQuery(workspaceId))
  // The group from the URL (cached memberships), so these don't wait for the workspace row.
  void queryClient.ensureQueryData(myTeamsQuery(user.id)).then((memberships) => {
    const team = memberships.find((m) => m.team.slug === params.teamSlug)?.team
    if (!team) return
    void queryClient.prefetchQuery(teamReposQuery(team.id))
    void queryClient.prefetchQuery(githubInstallationsQuery(team.id))
  }, () => {}) // a failure shows on the page, which reads the same queries
  // The open-issue counts, only with the Issues tool (that needs the workspace row).
  void queryClient.ensureQueryData(workspaceQuery(workspaceId)).then((workspace) => {
    if (workspace?.modules.includes('issues')) void queryClient.prefetchQuery(workspaceIssuesQuery(workspaceId))
  }, () => {})
  return null
}

/** What /github/callback shows when it doesn't redirect straight back to Group settings. */
export type GitHubCallbackResult =
  | { kind: 'connected'; account: string }
  | { kind: 'choose'; state: string; teamSlug: string; accounts: GitHubAccountChoice[]; connected: string[] }
  | { kind: 'requested' }
  | { kind: 'updated' }
  | { kind: 'error'; message: string }

/**
 * /github/callback: GitHub sends a group owner/admin here with the state from
 * Connect GitHub (?state), after signing in (?code) or installing the Calsko App
 * (?code&installation_id). The `github` Edge Function verifies it all with
 * GitHub, then either connects, asks which already-installed account to use, or
 * says to install the App first (we go to GitHub's install page, same state).
 * Once connected, a tab opened for this says it can be closed; otherwise we go
 * back to Group settings.
 */
export async function githubCallbackLoader({ request }: LoaderFunctionArgs): Promise<GitHubCallbackResult | Response> {
  await requireUser(request)
  const params = new URL(request.url).searchParams
  const setupAction = params.get('setup_action')
  const state = params.get('state')
  const code = params.get('code') || undefined
  const id = Number(params.get('installation_id'))
  const installationId = Number.isSafeInteger(id) && id > 0 ? id : undefined

  // An org member asked an org owner to approve the install; nothing to connect yet.
  if (setupAction === 'request') return { kind: 'requested' }
  // Repo access changed from GitHub's settings: takes effect on GitHub right away.
  if (!state && setupAction === 'update') return { kind: 'updated' }
  if (!state || (!code && !installationId)) {
    return { kind: 'error', message: 'This GitHub link is incomplete. Start again from Group settings → Repositories.' }
  }

  try {
    const result = await connectGitHub({ state, code, installationId })
    if (result.kind === 'install') return redirect(githubInstallUrl(state))
    if (result.kind === 'choose') {
      return { kind: 'choose', state, teamSlug: result.teamSlug, accounts: result.accounts, connected: result.connected }
    }
    return finishGitHubConnect(result.teamSlug, result.account)
  } catch (error) {
    // Saved on GitHub's settings page, with nothing here to connect.
    if (!code && setupAction === 'update') return { kind: 'updated' }
    return { kind: 'error', message: errorMessage(error) }
  }
}

/** After connecting: refresh this tab and the others; the tab opened for it says so, any other goes to settings. */
export async function finishGitHubConnect(teamSlug: string, account: string): Promise<GitHubCallbackResult | Response> {
  await queryClient.invalidateQueries({ queryKey: repoKeys.all })
  if (announceGitHubConnected()) return { kind: 'connected', account }
  return redirect(`/t/${teamSlug}/settings`)
}
