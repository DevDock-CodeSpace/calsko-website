// The part of error tracking the issue page needs: the error an issue was made for, embedded in
// issueQuery. Kept apart from api.ts so the issue page doesn't load the settings code.

/** The error an issue came from (no request of its own). */
export type IssueError = {
  id: string
  title: string
  url: string | null
  first_seen: string
  last_seen: string
  total_count: number
  previous: { number: number } | null
  days: { day: string; count: number }[]
}

/** Embedded by issueQuery: `error:<this>` gives the issue's error, if it came from one. */
export const ISSUE_ERROR_EMBED =
  'error:error_groups!error_groups_issue_id_fkey(id, title, url, first_seen, last_seen, total_count, previous:issues!error_groups_previous_issue_id_fkey(number), days:error_group_days(day, count))'

/** PostgREST returns the embed as a list (the unique index is partial); an issue has at most one. */
export function toIssueError(embed: unknown): IssueError | null {
  const row = (Array.isArray(embed) ? embed[0] : embed) as IssueError | undefined
  return row ? { ...row, total_count: Number(row.total_count) } : null
}
