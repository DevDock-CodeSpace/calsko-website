import { LoaderCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLoaderData, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { githubInstallUrl } from '@/features/repos/api'
import { GitHubMark } from '@/features/repos/components/GitHubMark'
import { usePickGitHubInstallation } from '@/features/repos/hooks'
import type { GitHubCallbackResult } from '@/features/repos/loaders'

const copy: Record<Exclude<GitHubCallbackResult['kind'], 'choose'>, { title: string; body?: string }> = {
  connected: { title: 'GitHub connected' },
  requested: {
    title: 'Install requested',
    body: 'An owner of that GitHub organization has to approve the Calsko app. Once they do, connect again from Group settings → Repositories.',
  },
  updated: {
    title: 'GitHub settings saved',
    body: 'Changes to which repositories Calsko can see apply right away.',
  },
  error: { title: 'GitHub wasn’t connected' },
}

/** Shown after the GitHub round trip when it doesn't go straight back to Group settings. */
export function GitHubCallbackPage() {
  const result = useLoaderData() as GitHubCallbackResult
  // A pick on this page ends like a connection made by the loader.
  const [picked, setPicked] = useState<string | null>(null)
  if (result.kind === 'choose' && picked === null) return <ChooseAccount result={result} onConnected={setPicked} />
  if (result.kind === 'connected' || picked !== null) {
    const account = picked ?? (result.kind === 'connected' ? result.account : '')
    return (
      <Shell
        title={copy.connected.title}
        body={`Calsko can now see the repositories you gave ${account} access to. Group settings in your other tab has updated, so you can close this one.`}
      >
        {/* Browsers only let a page close a tab that a script opened; this one was. */}
        <Button onClick={() => window.close()}>Close this tab</Button>
      </Shell>
    )
  }
  const { title, body } = copy[result.kind as Exclude<GitHubCallbackResult['kind'], 'choose' | 'connected'>]
  return (
    <Shell title={title} body={result.kind === 'error' ? result.message : body}>
      <Button asChild>
        <Link to="/app">Back to Calsko</Link>
      </Button>
    </Shell>
  )
}

/** The App is already on accounts this person can reach: pick one, or install it on another. */
function ChooseAccount({
  result,
  onConnected,
}: {
  result: Extract<GitHubCallbackResult, { kind: 'choose' }>
  onConnected: (account: string) => void
}) {
  const navigate = useNavigate()
  const pick = usePickGitHubInstallation()
  return (
    <Shell
      title="Which GitHub account?"
      body="The Calsko app is already installed on these GitHub accounts. Pick the one this group should use."
    >
      <ul className="w-full max-w-sm divide-y rounded-md border text-left">
        {result.accounts.map((a) => (
          <li key={a.installationId}>
            <button
              type="button"
              disabled={pick.isPending}
              onClick={() =>
                pick.mutate(
                  { state: result.state, installationId: a.installationId },
                  {
                    onSuccess: (done) =>
                      done.openedTab ? onConnected(done.account) : navigate(`/t/${done.teamSlug}/settings`),
                  },
                )
              }
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
            >
              <GitHubMark className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.account}</span>
                <span className="block text-xs text-muted-foreground">
                  {a.type === 'Organization' ? 'GitHub organization' : 'GitHub account'}
                </span>
              </span>
              {pick.isPending && pick.variables?.installationId === a.installationId ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-xs text-muted-foreground">Connect</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {pick.isError && (
        <p role="alert" className="max-w-sm text-sm text-destructive">
          {pick.error.message}
        </p>
      )}
      {result.connected.length > 0 && (
        <p className="max-w-sm text-xs text-muted-foreground">Already connected to this group: {result.connected.join(', ')}.</p>
      )}
      <a href={githubInstallUrl(result.state)} className="text-sm underline underline-offset-4 hover:text-foreground">
        Install it on another GitHub account
      </a>
    </Shell>
  )
}

function Shell({ title, body, children }: { title: string; body?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-4 text-center">
      <p className="font-mono text-sm text-muted-foreground">github</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      {children}
    </div>
  )
}
