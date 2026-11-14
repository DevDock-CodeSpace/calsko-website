import { useMutation, useQueryClient, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { Bug, GitBranch, LoaderCircle, MoreHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PersonAvatar } from '@/components/PersonRow'
import { GitHubMark } from '@/features/repos/components/GitHubMark'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/errors'
import { formatShortDate, timeAgo } from '@/lib/format'
import {
  activityQuery,
  addComment,
  commentsQuery,
  deleteComment,
  issueKeys,
  updateComment,
  workspaceIssuesQuery,
  type IssueActivity as ActivityEntry,
  type IssueComment,
  type IssueDetail,
  type IssuePriority,
  type IssueStatus,
} from '../api'
import { cycleTitle } from '../cycles'
import { useIssueContext } from '../hooks'
import { hoursLabel, issueIdentifier, priorityLabel, statusLabel } from '../meta'
import { PriorityIcon } from './PriorityIcon'
import { StatusIcon } from './StatusIcon'

/**
 * Linear's activity feed: the issue's history (who changed what, from the
 * database's activity log) interleaved with comments, oldest first, then the
 * comment box. Authors edit their own comments; authors and managers delete.
 */
export function IssueActivity({ issue }: { issue: IssueDetail }) {
  const { canManage, userId } = useIssueContext()
  const [{ data: comments }, { data: activity }] = useSuspenseQueries({ queries: [commentsQuery(issue.id), activityQuery(issue.id)] })
  const describe = useDescribeActivity()
  const queryClient = useQueryClient()
  const [now] = useState(Date.now)
  const [draft, setDraft] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: issueKeys.comments(issue.id) })

  const post = useMutation({
    mutationFn: () => addComment(issue.id, issue.workspace_id, draft),
    onSuccess: async () => {
      setDraft('')
      await refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = () => {
    if (draft.trim() && !post.isPending) post.mutate()
  }

  const feed = [
    ...activity.map((a) => ({ at: a.created_at, key: `a${a.id}`, activity: a })),
    ...comments.map((c) => ({ at: c.created_at, key: `c${c.id}`, comment: c })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <section aria-label="Activity">
      <h2 className="mb-3 text-sm font-semibold">Activity</h2>
      {feed.length > 0 && (
        <ul className="mb-4 space-y-3">
          {feed.map((item) =>
            'comment' in item && item.comment ? (
              <CommentItem
                key={item.key}
                comment={item.comment}
                now={now}
                canEdit={item.comment.author_id === userId}
                canDelete={item.comment.author_id === userId || canManage}
                onChanged={refresh}
              />
            ) : 'activity' in item && item.activity ? (
              <ActivityItem key={item.key} entry={item.activity} now={now} text={describe(item.activity)} />
            ) : null,
          )}
        </ul>
      )}
      <div className="rounded-lg border focus-within:ring-2 focus-within:ring-brand/40">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={3}
          maxLength={10000}
          placeholder="Leave a comment…"
          aria-label="Leave a comment"
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <span className="font-mono text-[10px] text-muted-foreground">⌘↵</span>
          <Button size="sm" variant="secondary" disabled={!draft.trim() || post.isPending} onClick={submit}>
            {post.isPending && <LoaderCircle className="animate-spin" />}
            Comment
          </Button>
        </div>
      </div>
    </section>
  )
}

/**
 * One history line: small avatar, "Priya changed status from Todo to In Progress", time. GitHub for
 * webhook changes, Error tracking for issues it made, Calsko for parent status rollups.
 */
function ActivityItem({ entry, now, text }: { entry: ActivityEntry; now: number; text: ReactNode }) {
  const github = entry.via === 'github'
  const errors = entry.via === 'errors'
  const rollup = entry.via === 'rollup'
  return (
    <li className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
      {github ? (
        <GitHubMark className="size-4 shrink-0 text-foreground" />
      ) : errors ? (
        <Bug className="size-4 shrink-0 text-foreground" />
      ) : rollup ? (
        <GitBranch className="size-4 shrink-0 text-foreground" />
      ) : (
        <PersonAvatar profile={entry.actor} className="size-4" />
      )}
      <span className="min-w-0">
        <span className="font-medium text-foreground">
          {github ? 'GitHub' : errors ? 'Error tracking' : rollup ? 'Calsko' : (entry.actor?.display_name ?? 'Someone')}
        </span>{' '}
        {text}
      </span>
      <span aria-hidden>·</span>
      <time dateTime={entry.created_at} className="shrink-0">
        {timeAgo(entry.created_at, now)}
      </time>
    </li>
  )
}

/** Turns an activity row into words, resolving ids to names from what's already loaded. */
function useDescribeActivity() {
  const { workspace, members, cycles, repos } = useIssueContext()
  const issues = useSuspenseQuery(workspaceIssuesQuery(workspace.id)).data
  const person = (id: string | null) =>
    members.find((m) => m.user_id === id)?.profile?.display_name ?? 'a former member'
  const strong = (node: ReactNode) => <span className="font-medium text-foreground">{node}</span>
  const status = (s: string | null) => (
    <span className="inline-flex items-center gap-1 align-middle text-foreground">
      <StatusIcon status={s as IssueStatus} className="size-3" />
      {statusLabel[s as IssueStatus] ?? s}
    </span>
  )

  return (a: ActivityEntry): ReactNode => {
    const from = a.from_value
    const to = a.to_value
    switch (a.kind) {
      case 'created':
        return 'created the issue'
      case 'title':
        return <>changed the title to {strong(`“${to}”`)}</>
      case 'status':
        return <>changed status from {status(from)} to {status(to)}</>
      case 'priority': {
        const p = Number(to) as IssuePriority
        return p === 0 ? (
          'removed the priority'
        ) : (
          <>
            set priority to{' '}
            <span className="inline-flex items-center gap-1 align-middle text-foreground">
              <PriorityIcon priority={p} className="size-3" />
              {priorityLabel[p]}
            </span>
          </>
        )
      }
      case 'assignee':
        return to === null ? <>unassigned {strong(person(from))}</> : <>assigned the issue to {strong(person(to))}</>
      case 'parent': {
        const parent = issues.find((i) => i.id === to)
        if (to === null) return 'removed the parent issue'
        return <>made this a sub-issue of {strong(parent ? issueIdentifier(workspace.issue_key, parent.number) : 'a deleted issue')}</>
      }
      case 'cycle': {
        const cycle = cycles.find((c) => c.id === (to ?? from))
        const name = cycle ? cycleTitle(cycle) : 'a deleted sprint'
        return to === null ? <>removed the issue from {strong(name)}</> : <>moved the issue to {strong(name)}</>
      }
      case 'estimate':
        return to === null ? 'removed the estimate' : <>set the estimate to {strong(hoursLabel(Number(to)))}</>
      case 'due_date':
        return to === null ? 'removed the due date' : <>set the due date to {strong(formatShortDate(to))}</>
      case 'repo': {
        const repo = repos.find((r) => r.id === (to ?? from))
        const name = repo ? repo.name : 'a removed repository'
        return to === null ? <>removed the issue from {strong(name)}</> : <>moved the issue to {strong(name)}</>
      }
      case 'branch_created':
        return <>created branch {strong(to)}</>
      case 'pr_linked':
        return <>linked pull request {strong(`#${to}`)}</>
      case 'pr_merged':
        return <>merged pull request {strong(`#${to}`)}</>
      case 'pr_closed':
        return <>closed pull request {strong(`#${to}`)} without merging</>
      case 'label_added':
        return <>added label {strong(to)}</>
      case 'label_removed':
        return <>removed label {strong(to)}</>
    }
  }
}

function CommentItem({
  comment,
  now,
  canEdit,
  canDelete,
  onChanged,
}: {
  comment: IssueComment
  now: number
  canEdit: boolean
  canDelete: boolean
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const save = useMutation({
    mutationFn: () => updateComment(comment.id, draft),
    onSuccess: async () => {
      setEditing(false)
      await onChanged()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: () => deleteComment(comment.id),
    onSuccess: onChanged,
    onError: (error) => toast.error(errorMessage(error)),
  })
  const edited = comment.updated_at !== comment.created_at

  return (
    <li className="flex gap-3">
      <PersonAvatar profile={comment.author} className="mt-0.5 size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{comment.author?.display_name ?? 'Former member'}</span>
          <span className="text-muted-foreground">
            {timeAgo(comment.created_at, now)}
            {edited && ' · edited'}
          </span>
          {(canEdit || canDelete) && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" aria-label="Comment actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate()}>
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) save.mutate()
                if (e.key === 'Escape') {
                  setDraft(comment.body)
                  setEditing(false)
                }
              }}
              rows={3}
              aria-label="Edit comment"
              className="block w-full resize-none rounded-md border bg-transparent px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(comment.body)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={!draft.trim() || save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm whitespace-pre-wrap break-words">{comment.body}</p>
        )}
      </div>
    </li>
  )
}
