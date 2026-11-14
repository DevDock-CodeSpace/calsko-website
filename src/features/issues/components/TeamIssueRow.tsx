import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Plan } from '@/features/plans/api'
import { issuePath } from '@/features/teams/nav'
import { workspaceMembersQuery, type WorkspaceMember } from '@/features/workspaces/api'
import { cyclesQuery, type IssuePatch, type TeamIssue } from '../api'
import type { RowNest } from './IssueList'
import { IssueRowView } from './IssueRowView'

/**
 * A row on the group-wide Issues page: the project list's row, drawn from what the
 * group list already holds (sprint, labels, repos, assignee). The project's people
 * and sprints, which only the menus need, load when one of them first opens.
 */
export function TeamIssueRow({
  issue,
  subIssues,
  nest,
  teamSlug,
  userId,
  showProject,
  plans,
  update,
  onDelete,
}: {
  issue: TeamIssue
  subIssues?: { done: number; total: number }
  nest?: RowNest
  teamSlug: string
  userId: string
  showProject: boolean
  /** The group's plans (the page's one list). */
  plans: Plan[]
  update: (issue: TeamIssue, patch: IssuePatch) => void
  onDelete?: () => void
}) {
  const [wanted, setWanted] = useState(false)
  // Disabled until a menu opens; once one row has loaded them, every row of the project reads the cache.
  const members = useQuery({ ...workspaceMembersQuery(issue.workspace.id), enabled: wanted }).data
  const cycles = useQuery({ ...cyclesQuery(issue.workspace.id), enabled: wanted }).data
  const assignee: WorkspaceMember[] =
    issue.assignee_id && issue.assignee
      ? [{ user_id: issue.assignee_id, role: 'member', joined_at: '', via: 'member', profile: issue.assignee }]
      : []

  return (
    <IssueRowView
      issue={issue}
      subIssues={subIssues}
      nest={nest}
      onDelete={onDelete}
      source={{
        href: issuePath(teamSlug, issue.workspace.id, issue.number),
        workspace: issue.workspace,
        members: members ?? assignee,
        labels: issue.labels,
        cycles: cycles ?? (issue.cycle ? [issue.cycle] : []),
        repos: issue.workspace.repos,
        plans,
        userId,
        update: (patch) => update(issue, patch),
        project: showProject ? issue.workspace.title : undefined,
        onMenuOpen: () => setWanted(true),
      }}
    />
  )
}
