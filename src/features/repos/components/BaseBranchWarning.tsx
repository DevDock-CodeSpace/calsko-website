import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { workspaceIssuesQuery } from '@/features/issues/api'
import { errorMessage } from '@/lib/errors'
import { repoFullName, workspaceReposQuery } from '../api'
import { RepoBranchSettingsDialog } from './RepoBranchSettingsDialog'

/** Where a repo picker is: the project whose branch settings apply, and whether the caller can change them. */
export type BaseBranchCheck = { workspaceId: string; issueKey: string; canEdit: boolean }

/**
 * Shown after picking a connected repo that has no base branch in this project
 * (issue branches can't be created until it has one). Leads and admins open the
 * branch settings right here, on top of the issue or the new-issue form, so
 * closing them leaves everything as it was.
 */
export function BaseBranchWarning({
  check,
  repoId,
  onClose,
}: {
  check: BaseBranchCheck
  repoId: string
  onClose: () => void
}) {
  // Cached by every issue screen (useIssueContext), so this rarely asks the server.
  const repos = useQuery(workspaceReposQuery(check.workspaceId)).data ?? []
  const issues = useQuery({ ...workspaceIssuesQuery(check.workspaceId), enabled: check.canEdit })
  const [editing, setEditing] = useState(false)
  const repo = repos.find((r) => r.id === repoId)
  if (!repo || repo.installation_id === null || (repo.base_branch !== null && !editing)) return null

  if (editing) {
    return (
      <RepoBranchSettingsDialog
        workspaceId={check.workspaceId}
        issueKey={check.issueKey}
        issues={issues.data ?? []}
        issuesEnabled
        issuesLoading={issues.isPending}
        issuesError={issues.isError ? errorMessage(issues.error) : null}
        repoCount={repos.length}
        repo={repo}
        onOpenChange={(open) => !open && onClose()}
      />
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>No base branch yet</DialogTitle>
          <DialogDescription>
            Issue branches for <span className="font-mono">{repoFullName(repo)}</span> can’t be created until this project
            chooses the branch they start from.
            {!check.canEdit && ' Ask a project lead to choose one in the project’s GitHub settings.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {check.canEdit ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Not now
              </Button>
              <Button onClick={() => setEditing(true)}>Open branch settings</Button>
            </>
          ) : (
            <Button onClick={onClose}>OK</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
