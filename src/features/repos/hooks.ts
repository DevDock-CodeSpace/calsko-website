import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { issueKeys } from '@/features/issues/api'
import { DataError } from '@/lib/errors'
import {
  addGitHubRepo,
  announceGitHubConnected,
  connectGitHub,
  createRepo,
  deleteRepo,
  disconnectGitHub,
  GITHUB_CONNECT_CHANNEL,
  linkRepo,
  parseRepo,
  repoKeys,
  startGitHubConnect,
  unlinkRepo,
  type TeamRepo,
} from './api'

/** After a repo is unlinked or removed, issues may have lost their repo too. */
function useRefresh() {
  const queryClient = useQueryClient()
  return (issues: boolean) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: repoKeys.all }),
      issues ? queryClient.invalidateQueries({ queryKey: issueKeys.all }) : undefined,
    ])
}

/** Adds a repo to the group (owners/admins). */
export function useAddRepo(teamId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: string) => {
      const repo = parseRepo(input)
      if (!repo) throw new DataError('Enter a GitHub repository as owner/name or its github.com URL.')
      return createRepo(teamId, repo)
    },
    onSuccess: () => refresh(false),
  })
}

/** Adds a repo from GitHub to the group (owners/admins; checked by the Edge Function). */
export function useAddGitHubRepo(teamId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (githubRepoId: number) => addGitHubRepo(teamId, githubRepoId),
    onSuccess: () => refresh(false),
  })
}

/**
 * Links a repo to a workspace. `input` is a repo already in the group, or
 * (for group owners/admins) one from GitHub or a new "owner/name" or URL,
 * which is added to the group first.
 */
export function useLinkRepo(teamId: string, workspaceId: string, teamRepos: TeamRepo[], canAdd: boolean) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (input: { repoId: string } | { githubRepoId: number } | { text: string }) => {
      let repoId: string
      if ('repoId' in input) {
        repoId = input.repoId
      } else if ('githubRepoId' in input) {
        repoId = (await addGitHubRepo(teamId, input.githubRepoId)).id
      } else {
        const parsed = parseRepo(input.text)
        if (!parsed) throw new DataError('Enter a GitHub repository as owner/name or its github.com URL.')
        const existing = teamRepos.find(
          (r) =>
            r.owner.toLowerCase() === parsed.owner.toLowerCase() && r.name.toLowerCase() === parsed.name.toLowerCase(),
        )
        if (existing) repoId = existing.id
        else if (canAdd) repoId = (await createRepo(teamId, parsed)).id
        else throw new DataError('That repository isn’t in this group yet. Ask a group owner or admin to add it.')
      }
      await linkRepo({ teamId, workspaceId, repoId })
    },
    onSettled: () => refresh(false),
  })
}

export function useUnlinkRepo(workspaceId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (repoId: string) => unlinkRepo(workspaceId, repoId),
    onSuccess: () => refresh(true),
  })
}

export function useDeleteRepo() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (repoId: string) => deleteRepo(repoId),
    onSuccess: () => refresh(true),
  })
}

/**
 * Opens GitHub in a new tab to install the App. When that tab finishes (/github/callback),
 * this one refetches the install and repos.
 */
export function useConnectGitHub(teamId: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = new BroadcastChannel(GITHUB_CONNECT_CHANNEL)
    channel.onmessage = () => void queryClient.invalidateQueries({ queryKey: repoKeys.all })
    return () => channel.close()
  }, [queryClient])
  return useMutation({ mutationFn: () => startGitHubConnect(teamId) })
}

export function useDisconnectGitHub(teamId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (installationId: number) => disconnectGitHub(teamId, installationId),
    onSuccess: () => refresh(false),
  })
}

/** Connects the account picked on /github/callback (one the Edge Function offered this person). */
export function usePickGitHubInstallation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { state: string; installationId: number }) => {
      const result = await connectGitHub(input)
      if (result.kind !== 'connected') throw new DataError('That GitHub account wasn’t connected. Start again from Group settings.')
      await queryClient.invalidateQueries({ queryKey: repoKeys.all })
      return { ...result, openedTab: announceGitHubConnected() }
    },
  })
}
