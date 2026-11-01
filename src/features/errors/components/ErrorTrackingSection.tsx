import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Bug, LoaderCircle, MoreHorizontal, Plus, RefreshCw, Webhook } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SettingsSection } from '@/components/SettingsSection'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { issueKeys } from '@/features/issues/api'
import { teamPlansQuery } from '@/features/plans/api'
import { useCurrentTeam, useCurrentWorkspace } from '@/features/teams/hooks'
import { errorMessage } from '@/lib/errors'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  deleteErrorSource,
  errorKeys,
  errorSourcesQuery,
  type ErrorSource,
  rotateErrorSourceToken,
  syncErrorSource,
  updateErrorSource,
  webhookUrl,
} from '../api'
import { ConnectErrorSourceDialog } from './ConnectErrorSourceDialog'
import { CopyField } from './CopyField'
import { WebhookDetails } from './WebhookDetails'

/**
 * Project settings → Error tracking (groups with the error_tracking flag; managers only, the page checks):
 * the project's error sources, connecting one, Sync now, switching off and removing.
 */
export function ErrorTrackingSection() {
  const { workspace } = useCurrentWorkspace()
  const { data: sources } = useSuspenseQuery(errorSourcesQuery(workspace.id))
  const [connecting, setConnecting] = useState(false)

  return (
    <SettingsSection
      title="Error tracking"
      description="Errors from PostHog, or any tool that can send a webhook, become issues here (Backlog, labelled Error and with where they came from, optionally in a plan). Calsko collects them once a day; the same error again only adds to its count."
    >
      <div className="space-y-4">
        {sources.length > 0 && (
          <ul className="divide-y rounded-md border">
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </ul>
        )}
        <Button size="sm" variant="outline" onClick={() => setConnecting(true)}>
          <Plus /> Connect an error tracker
        </Button>
      </div>
      {connecting && <ConnectErrorSourceDialog workspaceId={workspace.id} open onOpenChange={setConnecting} />}
    </SettingsSection>
  )
}

function SourceRow({ source }: { source: ErrorSource }) {
  const queryClient = useQueryClient()
  const { team } = useCurrentTeam()
  // The group's plans, for "· into <plan>" (usually cached; loaded with the page).
  const { data: plans } = useQuery({ ...teamPlansQuery(team.id), enabled: source.plan_id !== null })
  const [now] = useState(Date.now)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [webhook, setWebhook] = useState<{ token: string | null } | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: errorKeys.sources(source.workspace_id) })

  const sync = useMutation({
    mutationFn: () => syncErrorSource(source.id),
    onSuccess: async (result) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: issueKeys.all })])
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: () => updateErrorSource(source.id, { enabled: !source.enabled }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const rotate = useMutation({
    mutationFn: () => rotateErrorSourceToken(source.id),
    onSuccess: (token) => setWebhook({ token }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => deleteErrorSource(source.id),
    onSuccess: async () => {
      setRemoving(false)
      await refresh()
      toast.success(`${source.name} removed`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const Icon = source.provider === 'posthog' ? Bug : Webhook
  const plan = plans?.find((p) => p.id === source.plan_id)
  const kind = source.provider === 'posthog' ? `PostHog · project ${source.config.project_id ?? '?'}` : 'Webhook'
  const status = !source.enabled
    ? 'Switched off'
    : source.last_sync_message
      ? `${source.last_synced_at ? `Synced ${timeAgo(source.last_synced_at, now)} · ` : ''}${source.last_sync_message}`
      : 'Not synced yet. The daily sync runs at 06:00 UTC.'

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Icon className={cn('size-4 shrink-0', source.enabled ? 'text-foreground' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {source.name} <span className="font-normal text-muted-foreground">· {kind}</span>
          {plan && <span className="font-normal text-muted-foreground"> · into {plan.name}</span>}
        </p>
        <p className={cn('truncate text-xs', source.last_sync_ok === false && source.enabled ? 'text-destructive' : 'text-muted-foreground')} title={status}>
          {status}
        </p>
      </div>
      {source.enabled && (
        <Button size="sm" variant="ghost" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Sync now
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`More for ${source.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit…</DropdownMenuItem>
          {source.provider === 'webhook' && (
            <>
              <DropdownMenuItem onSelect={() => setWebhook({ token: null })}>Show webhook URL</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rotate.mutate()}>New token…</DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => toggle.mutate()}>{source.enabled ? 'Switch off' : 'Switch on'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
            Remove…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && <ConnectErrorSourceDialog workspaceId={source.workspace_id} open onOpenChange={setEditing} editing={source} />}
      {webhook && (
        <Dialog open onOpenChange={(open) => !open && setWebhook(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{webhook.token ? 'New token' : source.name}</DialogTitle>
              <DialogDescription>
                {webhook.token
                  ? 'The old token stopped working. Update it wherever errors are sent from.'
                  : 'The token was shown once, when the webhook was made. Make a new one from the menu if it is lost.'}
              </DialogDescription>
            </DialogHeader>
            {webhook.token ? <WebhookDetails sourceId={source.id} token={webhook.token} /> : <CopyField label="Webhook URL" value={webhookUrl(source.id)} />}
            <DialogFooter>
              <Button onClick={() => setWebhook(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${source.name}?`}
        description="Calsko stops collecting its errors and forgets its key or token. Issues it made stay, without their error counts."
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  )
}
