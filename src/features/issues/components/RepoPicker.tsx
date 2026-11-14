import { useState, type ReactNode, type SyntheticEvent } from 'react'
import { repoFullName, type Repo } from '@/features/repos/api'
import { BaseBranchWarning, type BaseBranchCheck } from '@/features/repos/components/BaseBranchWarning'
import { GitHubMark } from '@/features/repos/components/GitHubMark'
import { Picker } from './Picker'

const NONE = 'none'
const stop = (event: SyntheticEvent) => event.stopPropagation()

/**
 * Point an issue at one of the workspace's linked repos, or none. With `check`,
 * picking a repo that has no base branch in the project says so (even when it
 * was already picked, e.g. a project's only repo, chosen by default).
 */
export function RepoPicker({
  value,
  repos,
  onChange,
  children,
  align,
  check,
}: {
  value: string | null
  repos: Repo[]
  onChange: (repoId: string | null) => void
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  check?: BaseBranchCheck
}) {
  const [warnFor, setWarnFor] = useState<string | null>(null)
  return (
    <>
      <Picker
        placeholder="Set repository…"
        align={align}
        selected={[value ?? NONE]}
        onSelect={(v) => {
          const next = v === NONE ? null : v
          if (next !== value) onChange(next)
          if (next && check) setWarnFor(next)
        }}
        options={[
          { value: NONE, label: 'No repository', icon: <GitHubMark className="size-3.5 text-muted-foreground" /> },
          ...repos.map((r) => ({
            value: r.id,
            label: repoFullName(r),
            icon: <GitHubMark className="size-3.5 text-muted-foreground" />,
          })),
        ]}
      >
        {children}
      </Picker>
      {warnFor && check && (
        // React passes the dialog's events up to the picker's parents (the new-issue form, a list row):
        // Enter in the branch settings mustn't create the issue, nor keys trigger row shortcuts.
        <span className="contents" onSubmit={stop} onKeyDown={stop} onClick={stop} onPaste={stop} onDrop={stop}>
          <BaseBranchWarning check={check} repoId={warnFor} onClose={() => setWarnFor(null)} />
        </span>
      )}
    </>
  )
}
