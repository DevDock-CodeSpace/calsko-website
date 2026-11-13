import { useCurrentTeam } from '@/features/teams/hooks'
import { issuePath } from '@/features/teams/nav'
import type { Issue } from '../api'
import { useIssueContext, useUpdateIssue } from '../hooks'
import { HiddenRowMenus } from './HiddenRowMenus'
import type { RowNest } from './IssueList'
import { IssueRowView } from './IssueRowView'

/** A row in a project's list: `IssueRowView` fed by the project's issue context. */
export function IssueRow({
  issue,
  subIssues,
  nest,
  onDelete,
}: {
  issue: Issue
  subIssues?: { done: number; total: number }
  nest?: RowNest
  onDelete?: () => void
}) {
  const { team } = useCurrentTeam()
  const { workspace, members, labels, cycles, repos, plans, userId } = useIssueContext()
  const update = useUpdateIssue()

  return (
    <IssueRowView
      issue={issue}
      subIssues={subIssues}
      nest={nest}
      onDelete={onDelete}
      source={{
        href: issuePath(team.slug, workspace.id, issue.number),
        workspace,
        members,
        labels,
        cycles,
        repos,
        plans,
        userId,
        update: (patch) => update.mutate({ issue, patch }),
      }}
    >
      <HiddenRowMenus issue={issue} className="absolute top-full right-24" />
    </IssueRowView>
  )
}
