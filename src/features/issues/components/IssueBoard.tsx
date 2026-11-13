import { Plus } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { cn } from '@/lib/utils'
import type { Issue, IssueStatus } from '../api'
import { useUpdateIssue } from '../hooks'
import { compareIssues, STATUS_ORDER, statusLabel } from '../meta'
import { subIssueStats } from '../sub-issues'
import { IssueCard } from './IssueCard'
import { StatusIcon } from './StatusIcon'

/** dataTransfer type for dragging a card between columns. */
const DRAG_TYPE = 'application/x-devdock-issue'

/** Linear's board: a column per status; drag a card to change its status. */
export function IssueBoard({ issues, onCreate }: { issues: Issue[]; onCreate: (status: IssueStatus) => void }) {
  const update = useUpdateIssue()
  const [over, setOver] = useState<IssueStatus | null>(null)
  const stats = subIssueStats(issues)

  const onDrop = (event: DragEvent, status: IssueStatus) => {
    event.preventDefault()
    setOver(null)
    const id = event.dataTransfer.getData(DRAG_TYPE)
    const issue = issues.find((i) => i.id === id)
    if (issue && issue.status !== status) update.mutate({ issue, patch: { status } })
  }

  return (
    // Bleeds to the page edge on small screens so columns can scroll sideways.
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
      <div className="flex min-w-max gap-3">
        {STATUS_ORDER.map((status) => {
          const items = issues.filter((i) => i.status === status).sort(compareIssues)
          return (
            <section
              key={status}
              aria-label={statusLabel[status]}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOver(status)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(e) => onDrop(e, status)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-lg bg-muted/40 transition-colors',
                over === status && 'bg-muted ring-1 ring-brand/50',
              )}
            >
              <div className="flex h-10 items-center gap-2 px-3">
                <StatusIcon status={status} />
                <span className="text-sm font-medium">{statusLabel[status]}</span>
                <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
                <button
                  type="button"
                  onClick={() => onCreate(status)}
                  aria-label={`New issue in ${statusLabel[status]}`}
                  className="ml-auto flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <ul className="flex max-h-80 min-h-24 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-2">
                {items.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    subIssues={stats.get(issue.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, issue.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
