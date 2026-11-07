import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/hooks'
import { teamPlansQuery } from '@/features/plans/api'
import { workspaceReposQuery } from '@/features/repos/api'
import { useCurrentWorkspace } from '@/features/teams/hooks'
import { workspaceMembersQuery } from '@/features/workspaces/api'
import { errorMessage } from '@/lib/errors'
import {
  createIssueBranch,
  cyclesQuery,
  issueKeys,
  labelsQuery,
  setIssueLabels,
  updateIssue,
  type Issue,
  type IssueDetail,
  type IssuePatch,
} from './api'
import { announceBranch } from './copyBranch'
import { readFilters, writeFilters, type IssueFilters } from './filters'
import { ownSave, ownWrite } from '@/lib/realtime'

/**
 * What issue screens need about the current workspace: its members (assignees),
 * labels, cycles, linked repos, and whether the caller manages it (delete issues, manage labels and cycles).
 * `canManage` mirrors private.can_manage_workspace() for showing UI only.
 */
export function useIssueContext() {
  const { user } = useAuth()
  const { workspace, can } = useCurrentWorkspace()
  // One batch: separate useSuspenseQuery calls in a row would each wait for the one before (a waterfall).
  const [{ data: members }, { data: labels }, { data: cycles }, { data: repos }, { data: plans }] = useSuspenseQueries({
    queries: [
      workspaceMembersQuery(workspace.id),
      labelsQuery(workspace.id),
      cyclesQuery(workspace.id),
      workspaceReposQuery(workspace.id),
      teamPlansQuery(workspace.team_id),
    ],
  })
  return { workspace, members, labels, cycles, repos, plans, canManage: can.canEdit, userId: user.id }
}

type UpdateVars = { issue: Pick<Issue, 'id' | 'number'>; patch?: IssuePatch; labelIds?: string[] }

/**
 * Creates the issue's branch on GitHub (its repo, or the project's only one).
 * Toasts the result; a no-op if the issue already has its branch.
 */
export function useCreateIssueBranch() {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  return useMutation({
    mutationFn: (issue: Pick<Issue, 'id' | 'number'>) => {
      // The function logs activity and the branch, both refetched below. (It may also set the
      // issue's repo; that echo isn't ours to recognise, so it refetches the issue once more.)
      for (const table of ['issue_activity', 'issue_branches']) ownWrite(table, issue.id, 15_000)
      return createIssueBranch(issue.id)
    },
    onSuccess: ({ branch, created }) => void announceBranch(branch.name, created),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: (_data, _error, issue) => {
      // The project's only repo becomes the issue's repo when it had none; only then do the lists change.
      const hadRepo = queryClient.getQueryData<Issue[]>(issueKeys.workspace(workspace.id))?.find((i) => i.id === issue.id)?.repo_id != null
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKeys.branches(issue.id) }),
        queryClient.invalidateQueries({ queryKey: issueKeys.activity(issue.id) }),
        queryClient.invalidateQueries({ queryKey: issueKeys.detail(workspace.id, issue.number) }),
        queryClient.invalidateQueries({ queryKey: issueKeys.workspace(workspace.id), refetchType: hadRepo ? 'none' : 'active' }),
      ])
    },
  })
}

/**
 * Edits an issue (fields and/or labels) optimistically, like Linear: the list
 * and the issue page update at once, and roll back with a toast if the save fails.
 * Moving an issue into In Progress also creates its branch, when the project has repos.
 */
export function useUpdateIssue() {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const createBranch = useCreateIssueBranch()
  /** Moving into In Progress creates the issue's branch, when the project has repos. */
  const startsBranch = (issue: Pick<Issue, 'id'>, patch: UpdateVars['patch'], context: { previousList?: Issue[]; previousDetail?: IssueDetail | null } | undefined) => {
    const before = context?.previousDetail?.status ?? context?.previousList?.find((i) => i.id === issue.id)?.status
    const hasRepos = (queryClient.getQueryData(workspaceReposQuery(workspace.id).queryKey)?.length ?? 0) > 0
    return patch?.status === 'in_progress' && before !== 'in_progress' && hasRepos
  }

  return useMutation({
    // One save at a time per workspace, in the order they were made, so an older
    // edit can't land on top of a newer one (optimistic updates still apply at once).
    scope: { id: `issues:${workspace.id}` },
    mutationFn: async ({ issue, patch, labelIds }: UpdateVars) => {
      // Shown optimistically and refetched below, so the echo of this save is dropped.
      ownWrite('issue_activity', issue.id)
      if (labelIds) ownWrite('issue_label_links', issue.id)
      if (patch && Object.keys(patch).length > 0) {
        const done = ownSave('issues', issue.id)
        try {
          done(await updateIssue(issue.id, patch))
        } catch (error) {
          done()
          throw error
        }
      }
      if (labelIds) await setIssueLabels(issue.id, labelIds)
    },
    onMutate: async ({ issue, patch, labelIds }) => {
      const listKey = issueKeys.workspace(workspace.id)
      const detailKey = issueKeys.detail(workspace.id, issue.number)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ])
      const previousList = queryClient.getQueryData<Issue[]>(listKey)
      const previousDetail = queryClient.getQueryData<IssueDetail | null>(detailKey)
      const changes = { ...patch, ...(labelIds ? { labelIds } : {}) }
      queryClient.setQueryData<Issue[]>(listKey, (old) =>
        old?.map((i) => {
          if (i.id !== issue.id) return i
          // The list doesn't hold descriptions.
          const { description: _description, ...rest } = { ...i, ...changes }
          return rest
        }),
      )
      queryClient.setQueryData<IssueDetail | null>(detailKey, (old) => (old ? { ...old, ...changes } : old))
      return { listKey, detailKey, previousList, previousDetail }
    },
    onError: (error, _vars, context) => {
      if (context) {
        queryClient.setQueryData(context.listKey, context.previousList)
        // The description saves itself (IssueDescription); don't undo it here.
        queryClient.setQueryData<IssueDetail | null>(context.detailKey, (current) =>
          context.previousDetail && current
            ? { ...context.previousDetail, description: current.description }
            : context.previousDetail,
        )
      }
      toast.error(errorMessage(error))
    },
    onSuccess: (_data, { issue, patch }, context) => {
      if (startsBranch(issue, patch, context)) createBranch.mutate(issue)
    },
    onSettled: (_data, error, { issue, patch }, context) => {
      // Creating the branch refetches the issue, its activity and (if needed) the list when it finishes.
      if (error === null && startsBranch(issue, patch, context)) {
        void queryClient.invalidateQueries({ queryKey: ['issues', 'team'], refetchType: 'none' })
        return
      }
      // The optimistic copy already shows the edit. The server adds only `completed_at`
      // (on a status change) and the activity entry, so ask for no more than that;
      // after a failure, ask for everything.
      const lists = error !== null || patch?.status !== undefined
      if (lists) void queryClient.invalidateQueries({ queryKey: issueKeys.workspace(workspace.id) })
      // The group-wide Issues page (only marked stale unless it's open).
      void queryClient.invalidateQueries({ queryKey: ['issues', 'team'], refetchType: lists ? 'active' : 'none' })
      void queryClient.invalidateQueries({ queryKey: issueKeys.detail(workspace.id, issue.number) })
      void queryClient.invalidateQueries({ queryKey: issueKeys.activity(issue.id) })
    },
  })
}

type TeamUpdateVars = {
  /** `workspace.repos` (the group list has them) saves looking the project's repos up. */
  issue: Pick<Issue, 'id' | 'number' | 'status'> & { workspace: { id: string; repos?: unknown[] } }
  patch: IssuePatch
}

/**
 * `useUpdateIssue` for the group-wide Issues page, which isn't inside a project:
 * the same optimistic edit (rolled back with a toast), on the group's list. Moving
 * an issue into In Progress creates its branch, as in the project, when the project
 * has repos; they're looked up only then (cached after), so the page loads nothing extra.
 */
export function useUpdateTeamIssue(teamId: string) {
  const queryClient = useQueryClient()
  const listKey = ['issues', 'team', teamId]

  const startBranch = async (issue: TeamUpdateVars['issue']) => {
    const repos = issue.workspace.repos ?? (await queryClient.fetchQuery(workspaceReposQuery(issue.workspace.id)))
    if (repos.length === 0) return
    for (const table of ['issue_activity', 'issue_branches']) ownWrite(table, issue.id, 15_000)
    try {
      const { branch, created } = await createIssueBranch(issue.id)
      if (created) toast.success(`Created branch ${branch.name}`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      // It may also have set the issue's repo.
      void queryClient.invalidateQueries({ queryKey: issueKeys.branches(issue.id) })
      void queryClient.invalidateQueries({ queryKey: listKey })
    }
  }

  return useMutation({
    scope: { id: `issues:team:${teamId}` },
    mutationFn: async ({ issue, patch }: TeamUpdateVars) => {
      ownWrite('issue_activity', issue.id)
      const done = ownSave('issues', issue.id)
      try {
        done(await updateIssue(issue.id, patch))
      } catch (error) {
        done()
        throw error
      }
    },
    onMutate: async ({ issue, patch }) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<Issue[]>(listKey)
      queryClient.setQueryData<Issue[]>(listKey, (old) => old?.map((i) => (i.id === issue.id ? { ...i, ...patch } : i)))
      return { previous }
    },
    onError: (error, _vars, context) => {
      if (context) queryClient.setQueryData(listKey, context.previous)
      toast.error(errorMessage(error))
    },
    onSuccess: (_data, { issue, patch }) => {
      if (patch.status === 'in_progress' && issue.status !== 'in_progress') void startBranch(issue)
    },
    onSettled: (_data, error, { issue, patch }) => {
      // The server adds `completed_at` on a status change; after a failure, ask for everything.
      if (error !== null || patch.status !== undefined) void queryClient.invalidateQueries({ queryKey: listKey })
      // The project's own list and the issue page, if they were opened earlier (refetched when shown).
      void queryClient.invalidateQueries({ queryKey: issueKeys.workspace(issue.workspace.id), refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: issueKeys.detail(issue.workspace.id, issue.number), refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: issueKeys.activity(issue.id), refetchType: 'none' })
    },
  })
}

/** List ↔ Board, kept in the URL (?view=board) so it survives reloads and links. */
export function useIssueView() {
  const [params, setParams] = useSearchParams()
  const view: 'list' | 'board' = params.get('view') === 'board' ? 'board' : 'list'
  const setView = (next: 'list' | 'board') =>
    setParams(
      (p) => {
        if (next === 'board') p.set('view', 'board')
        else p.delete('view')
        return p
      },
      { replace: true },
    )
  return [view, setView] as const
}

/**
 * The filters, read straight from the URL (so a link, a saved view or a pinned person opens with
 * them, and the back button works). `setFilters` composes with the latest URL, so several quick
 * picks in a row all stick.
 */
export function useIssueFilters() {
  const [params, setParams] = useSearchParams()
  const latest = useRef(params)
  useEffect(() => {
    latest.current = params
  }, [params])
  const filters = useMemo(() => readFilters(params), [params])
  const setFilters = useCallback(
    (update: IssueFilters | ((previous: IssueFilters) => IssueFilters)) => {
      const next = typeof update === 'function' ? update(readFilters(latest.current)) : update
      const nextParams = writeFilters(latest.current, next)
      latest.current = nextParams
      setParams(nextParams, { replace: true })
    },
    [setParams],
  )
  return [filters, setFilters] as const
}
