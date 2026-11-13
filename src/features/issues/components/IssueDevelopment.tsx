import { useSuspenseQueries } from '@tanstack/react-query'
import { Check, Copy, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { issueBranchesQuery, pullRequestsQuery, type IssueDetail, type IssuePullRequest } from '../api'
import { useCreateIssueBranch, useIssueContext } from '../hooks'
import { issueBranchRepo } from '../meta'

const stateIcon: Record<IssuePullRequest['state'], { icon: typeof GitPullRequest; className: string; label: string }> = {
  draft: { icon: GitPullRequestDraft, className: 'text-muted-foreground', label: 'Draft' },
  open: { icon: GitPullRequest, className: 'text-green-600 dark:text-green-500', label: 'Open' },
  merged: { icon: GitMerge, className: 'text-violet-600 dark:text-violet-400', label: 'Merged' },
  closed: { icon: GitPullRequestClosed, className: 'text-red-600 dark:text-red-400', label: 'Closed' },
}

/**
 * Under the properties, like Linear's: the issue's branch on GitHub (created
 * when it moves to In Progress; "Create branch" otherwise), then the PRs
 * GitHub told us about. Hidden in projects without repos unless there's history.
 */
export function IssueDevelopment({ issue }: { issue: IssueDetail }) {
  const { repos } = useIssueContext()
  const [{ data: pullRequests }, { data: branches }] = useSuspenseQueries({ queries: [pullRequestsQuery(issue.id), issueBranchesQuery(issue.id)] })
  const createBranch = useCreateIssueBranch()
  const [copied, setCopied] = useState(false)
  if (repos.length === 0 && pullRequests.length === 0 && branches.length === 0) return null

  const created = branches[0]
  const baseBranchConfigured = issueBranchRepo(repos, issue.repo_id)?.base_branch != null
  // Once merged, GitHub deletes the branch ("Automatically delete head branches"), so link to the PR.
  const mergedPr = created && pullRequests.find((pr) => pr.state === 'merged' && pr.head_ref === created.name)
  const branch = created?.name ?? null
  // The branch goes in the issue's repo, or the project's only repo.
  const canCreate = !created && baseBranchConfigured && (issue.repo_id !== null || repos.length === 1)
  const copy = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Couldn’t copy. Select the branch name and copy it instead.')
    }
  }

  return (
    <section aria-label="Development" className="mt-6 space-y-2 border-t pt-4">
      <h2 className="px-2 text-xs text-muted-foreground">Development</h2>
      {branch && created && mergedPr && (
        <a
          href={mergedPr.url}
          target="_blank"
          rel="noreferrer"
          title={`Merged in #${mergedPr.number}. GitHub deletes the branch if the repo deletes merged branches.`}
          className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
        >
          <GitMerge className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <span className="truncate font-mono text-xs text-muted-foreground">{created.name}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">merged</span>
        </a>
      )}
      {branch && created && !mergedPr && (
        <a
          href={created.repo ? `https://github.com/${created.repo.owner}/${created.repo.name}/tree/${created.name}` : undefined}
          target="_blank"
          rel="noreferrer"
          title={`On GitHub${created.repo ? ` in ${created.repo.owner}/${created.repo.name}` : ''}, from ${created.base}`}
          className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
        >
          <GitBranch className="size-4 shrink-0 text-brand" />
          <span className="truncate font-mono text-xs">{created.name}</span>
        </a>
      )}
      {branch && !mergedPr && (
        <button
          type="button"
          onClick={() => branch && void copy(branch)}
          title="Copy the git branch name. A pull request from this branch (or mentioning the issue ID) links here and moves the issue."
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
        >
          {copied ? <Check className="size-4 shrink-0 text-brand" /> : <Copy className="size-4 shrink-0 text-muted-foreground" />}
          <span className={cn('truncate text-xs', !created && 'font-mono')}>
            {copied ? 'Copied' : created ? 'Copy branch name' : branch}
          </span>
        </button>
      )}
      {canCreate && (
        <button
          type="button"
          disabled={createBranch.isPending}
          onClick={() => createBranch.mutate(issue)}
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-60"
        >
          {createBranch.isPending ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <GitBranch className="size-4 shrink-0" />}
          <span className="truncate text-xs">Create branch on GitHub</span>
        </button>
      )}
      {!created && !canCreate && repos.length > 1 && issue.repo_id === null && (
        <p className="px-2 text-xs text-muted-foreground">Set the Repo to create a branch.</p>
      )}
      {!created && !canCreate && repos.length > 0 && (issue.repo_id !== null || repos.length === 1) && !baseBranchConfigured && (
        <p className="px-2 text-xs text-muted-foreground">Choose a base branch in GitHub settings to create an issue branch.</p>
      )}
      {pullRequests.length > 0 && (
        <ul className="space-y-0.5">
          {pullRequests.map((pr) => {
            const { icon: Icon, className, label } = stateIcon[pr.state]
            return (
              <li key={pr.id}>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${label}${pr.state === 'merged' && pr.landed_ref ? ` · now in ${pr.landed_ref}` : ''}${pr.repo ? ` · ${pr.repo.owner}/${pr.repo.name}` : ''}${pr.author_login ? ` · by ${pr.author_login}` : ''}`}
                  className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-label={label} />
                  <span className="min-w-0">
                    <span className="block truncate">{pr.title}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {pr.repo?.name ?? 'repo'}#{pr.number}
                      {pr.state === 'merged' && pr.landed_ref && ` · in ${pr.landed_ref}`}
                    </span>
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
