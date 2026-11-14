import type { Issue, IssuePriority, IssueStatus, LabelColor } from './api'

// Display metadata for issue fields, in Linear's order.

export const STATUS_ORDER: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled']

export const statusLabel: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  canceled: 'Canceled',
}

export const isClosed = (status: IssueStatus) => status === 'done' || status === 'canceled'

/** Menu order, as in Linear: No priority first, then most to least urgent. */
export const PRIORITY_ORDER: IssuePriority[] = [0, 1, 2, 3, 4]

export const priorityLabel: Record<IssuePriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

/** Whole-hour estimate buckets offered in the estimate picker. */
export const ESTIMATE_HOURS = [1, 2, 4, 8, 16, 24, 40]

/** "1 hour" / "5 hours". */
export const hoursLabel = (hours: number) => `${hours} ${hours === 1 ? 'hour' : 'hours'}`

export const LABEL_COLORS: LabelColor[] = ['default', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'violet']

/** The dot in front of a label. */
export const labelDotClass: Record<LabelColor, string> = {
  default: 'bg-muted-foreground',
  blue: 'bg-blue-500',
  teal: 'bg-teal-500',
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pink: 'bg-pink-500',
  violet: 'bg-violet-500',
}

/** CAP-12 */
export const issueIdentifier = (key: string, number: number) => `${key}-${number}`

/** The linked repo whose base branch applies to this issue, if it can be resolved. */
export function issueBranchRepo(repos: readonly { id: string; base_branch: string | null }[], repoId: string | null) {
  return repoId ? repos.find((repo) => repo.id === repoId) : repos.length === 1 ? repos[0] : undefined
}

/**
 * The git branch for an issue: dock/cap-12-add-login-page. The dock/ prefix
 * groups Calsko's branches on GitHub; the github-webhook function finds the
 * issue from the cap-12 part (and from the stored name). Same as branchName()
 * in supabase/functions/github/index.ts.
 */
export function issueBranchName(key: string, number: number, title: string) {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `dock/${key.toLowerCase()}-${number}${slug ? `-${slug}` : ''}`
}

/** Linear's default order inside a group: urgent → low, then no priority; newest first. */
export function compareIssues(a: Issue, b: Issue) {
  const rank = (p: IssuePriority) => (p === 0 ? 5 : p)
  return rank(a.priority) - rank(b.priority) || b.number - a.number
}
