import { useQuery, useSuspenseQueries } from '@tanstack/react-query'
import { ExternalLink, FolderGit2, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { workspaceIssuesQuery } from '@/features/issues/api'
import { isClosed } from '@/features/issues/meta'
import {
  githubInstallationsQuery,
  repoFullName,
  repoUrl,
  teamReposQuery,
  workspaceReposQuery,
  type LinkedRepo,
  type Repo,
} from '@/features/repos/api'
import { LinkRepoDialog } from '@/features/repos/components/LinkRepoDialog'
import { NotConnectedBadge } from '@/features/repos/components/NotConnectedBadge'
import { RepoBranchSettingsDialog } from '@/features/repos/components/RepoBranchSettingsDialog'
import { useUnlinkRepo } from '@/features/repos/hooks'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { issuesPath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'

/**
 * Workspace → GitHub: the repos this project works in (WorkspaceToolGate
 * checks the tool is on). Repos belong to the group; leads and group
 * owners/admins link and unlink them here.
 */
export function WorkspaceGitHubPage() {
  const { team, can: teamCan } = useCurrentTeam()
  const { workspace, can } = useCurrentWorkspace()
  // One batch (githubTabLoader starts them with the workspace): in a row, each waited for the one before.
  const [{ data: repos }, { data: teamRepos }, { data: installations }] = useSuspenseQueries({
    queries: [workspaceReposQuery(workspace.id), teamReposQuery(team.id), githubInstallationsQuery(team.id)],
  })
  const hasIssues = workspace.modules.includes('issues')
  // Open-issue counts, only when the Issues tool is on here.
  const issues = useQuery({ ...workspaceIssuesQuery(workspace.id), enabled: hasIssues }).data ?? []
  const unlink = useUnlinkRepo(workspace.id)
  const [confirm, setConfirm] = useState<Repo | null>(null)
  const [settings, setSettings] = useState<LinkedRepo | null>(null)

  const openCount = (repoId: string) => issues.filter((i) => i.repo_id === repoId && !isClosed(i.status)).length
  const assignedCount = (repoId: string) => issues.filter((i) => i.repo_id === repoId).length

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {hasIssues
            ? 'Repositories this project works in. Assign an issue to one from its Repo property.'
            : 'Repositories this project works in.'}
        </p>
        {can.canEdit && (
          <LinkRepoDialog
            teamId={team.id}
            workspaceId={workspace.id}
            teamRepos={teamRepos}
            linkedIds={repos.map((r) => r.id)}
            canAdd={teamCan.isAdmin}
            installations={installations}
          />
        )}
      </div>

      {repos.length === 0 ? (
        <p className="border-y py-10 text-center text-sm text-muted-foreground">
          {can.canEdit
            ? 'No repositories linked yet. Link one to start assigning issues to it.'
            : 'No repositories linked yet. The project lead links them.'}
        </p>
      ) : (
        <ul className="divide-y border-y">
          {repos.map((repo) => {
            const open = openCount(repo.id)
            return (
              <li key={repo.id} className="flex h-12 items-center gap-3 px-3 text-sm">
                <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={repoUrl(repo)}
                  target="_blank"
                  rel="noreferrer"
                  className="group/link inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline hover:underline-offset-4"
                >
                  <span className="truncate">
                    <span className="text-muted-foreground">{repo.owner}/</span>
                    {repo.name}
                  </span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/link:opacity-100" />
                </a>
                {installations.length > 0 && repo.installation_id === null && <NotConnectedBadge />}
                <span className="flex-1" />
                <span
                  className="hidden min-w-0 truncate font-mono text-[11px] text-muted-foreground md:block"
                  title="Choose a base branch before issue branches can be created; merging into the done branches marks issues Done"
                >
                  from {repo.base_branch ?? 'none'} · done on {repo.done_branches.length ? repo.done_branches.join(', ') : 'default'}
                </span>
                {hasIssues && (
                  <Link
                    to={`${issuesPath(team.slug, workspace.id)}?repo=${repo.id}`}
                    className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground"
                  >
                    {open} open {open === 1 ? 'issue' : 'issues'}
                  </Link>
                )}
                {can.canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`${repoFullName(repo)} actions`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setSettings(repo)}>Branch settings…</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(repo)}>
                        Unlink from {workspace.title}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {settings && (
        <RepoBranchSettingsDialog
          key={settings.id}
          workspaceId={workspace.id}
          repo={settings}
          onOpenChange={(open) => !open && setSettings(null)}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? `Unlink ${repoFullName(confirm)}?` : ''}
        description={
          confirm && assignedCount(confirm.id) > 0
            ? `${assignedCount(confirm.id)} ${assignedCount(confirm.id) === 1 ? 'issue loses' : 'issues lose'} this repository; the issues themselves stay. Nothing changes on GitHub.`
            : 'It stays in the group and in other projects. Nothing changes on GitHub.'
        }
        confirmLabel="Unlink"
        pending={unlink.isPending}
        onConfirm={() =>
          confirm &&
          unlink.mutate(confirm.id, {
            onSuccess: () => {
              toast.success(`Unlinked ${repoFullName(confirm)}`)
              setConfirm(null)
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}
