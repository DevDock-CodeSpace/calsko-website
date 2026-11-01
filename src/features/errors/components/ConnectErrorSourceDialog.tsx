import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bug, LoaderCircle, Webhook } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createPlan, planKeys } from '@/features/plans/api'
import { issueKeys } from '@/features/issues/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  createErrorSource,
  errorKeys,
  type ErrorProviderId,
  type ErrorSource,
  setErrorSourcePlan,
  updateErrorSource,
  updateErrorSourceConnection,
} from '../api'
import { NEW_PLAN, NO_PLAN, PlanField } from './PlanField'
import { WebhookDetails } from './WebhookDetails'

const HOSTS: Record<'posthog' | 'sentry', { value: string; label: string }[]> = {
  posthog: [
    { value: 'https://us.posthog.com', label: 'US Cloud (us.posthog.com)' },
    { value: 'https://eu.posthog.com', label: 'EU Cloud (eu.posthog.com)' },
  ],
  sentry: [
    { value: 'https://sentry.io', label: 'US (sentry.io)' },
    { value: 'https://de.sentry.io', label: 'EU (de.sentry.io)' },
  ],
}

const LABEL: Record<ErrorProviderId, string> = { posthog: 'PostHog', sentry: 'Sentry', webhook: 'Webhook' }

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing a source (name, plan; PostHog also its connection) instead of connecting a new one. */
  editing?: ErrorSource
}

/** Connect PostHog or a webhook to the project; or edit a source's name and plan (and PostHog's project, region and key). */
export function ConnectErrorSourceDialog({ workspaceId, open, onOpenChange, editing }: Props) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState<ErrorProviderId>(editing?.provider ?? 'posthog')
  const [name, setName] = useState(editing?.name ?? '')
  const [chosenHost, setHost] = useState(editing?.config.host ?? '')
  const [projectId, setProjectId] = useState(editing?.config.project_id ?? '')
  const [org, setOrg] = useState(editing?.config.org ?? '')
  const [sentryProject, setSentryProject] = useState(editing?.config.project ?? '')
  const pulled = provider !== 'webhook'
  const host = (pulled && HOSTS[provider].some((h) => h.value === chosenHost) ? chosenHost : '') || (pulled ? HOSTS[provider][0].value : '')
  const [apiKey, setApiKey] = useState('')
  const [made, setMade] = useState<{ id: string; token: string } | null>(null)
  const { team } = useCurrentTeam()
  const [plan, setPlan] = useState(editing?.plan_id ?? NO_PLAN)
  const [newPlanName, setNewPlanName] = useState('')
  const [includeExisting, setIncludeExisting] = useState(true)
  const planChanged = plan !== (editing?.plan_id ?? NO_PLAN)

  const save = useMutation({
    mutationFn: async () => {
      const config: Record<string, string> =
        provider === 'posthog'
          ? { host, project_id: projectId.trim() }
          : provider === 'sentry'
            ? { host, org: org.trim(), project: sentryProject.trim() }
            : {}
      let result: { id: string; token: string | null } | null = null
      if (editing) {
        if (pulled) await updateErrorSourceConnection(editing.id, config, apiKey.trim())
        if (name.trim() && name.trim() !== editing.name) await updateErrorSource(editing.id, { name: name.trim() })
      } else {
        result = await createErrorSource({
          workspaceId,
          provider,
          name: name.trim() || LABEL[provider],
          config,
          apiKey: pulled ? apiKey.trim() : undefined,
        })
      }
      if (planChanged) {
        const sourceId = editing?.id ?? result!.id
        const planId = plan === NEW_PLAN ? await createPlan(team.id, newPlanName) : plan === NO_PLAN ? null : plan
        await setErrorSourcePlan(sourceId, planId, includeExisting)
      }
      return result
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: errorKeys.sources(workspaceId) }),
        planChanged && queryClient.invalidateQueries({ queryKey: planKeys.all }),
        planChanged && editing && queryClient.invalidateQueries({ queryKey: issueKeys.all }),
      ])
      if (result?.token) {
        setMade({ id: result.id, token: result.token })
        return
      }
      toast.success(editing ? 'Saved' : `${LABEL[provider]} connected. Its errors arrive with the next daily sync, or press Sync now.`)
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const ready =
    (provider === 'webhook' ||
      ((provider === 'posthog' ? /^\d+$/.test(projectId.trim()) : org.trim() !== '' && sentryProject.trim() !== '') &&
        (editing ? true : apiKey.trim().length >= 8))) &&
    (plan !== NEW_PLAN || newPlanName.trim().length > 0)

  if (made) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Webhook ready</DialogTitle>
            <DialogDescription>
              Point your tools’ alerts here (new and returning errors, or batches), not one request per occurrence. Errors are counted as they arrive and become issues in the daily run.
            </DialogDescription>
          </DialogHeader>
          <WebhookDetails sourceId={made.id} token={made.token} />
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'Connect an error tracker'}</DialogTitle>
            <DialogDescription>
              {editing
                ? pulled
                  ? 'Leave the key empty to keep the one saved.'
                  : 'The webhook URL and token stay the same.'
                : 'Once a day Calsko collects its errors. A new kind of error becomes an issue here; the same error again only adds to its count.'}
            </DialogDescription>
          </DialogHeader>

          {!editing && (
            <div role="radiogroup" aria-label="Error tracker" className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  { id: 'posthog', icon: Bug, title: 'PostHog', text: 'Read once a day with an API key.' },
                  { id: 'sentry', icon: Bug, title: 'Sentry', text: 'Read once a day with an auth token.' },
                  { id: 'webhook', icon: Webhook, title: 'Webhook', text: 'Datadog, New Relic, your own code… send alerts to a URL.' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={provider === option.id}
                  onClick={() => setProvider(option.id)}
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none',
                    provider === option.id && 'border-brand bg-brand/5',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <option.icon className="size-4" /> {option.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{option.text}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="error-source-name">Name</Label>
            <Input
              id="error-source-name"
              value={name}
              maxLength={60}
              placeholder={provider === 'webhook' ? 'Datadog alerts' : LABEL[provider]}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {provider === 'posthog' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="error-source-host">Region</Label>
                  <Select value={host} onValueChange={(value) => value && setHost(value)}>
                    <SelectTrigger id="error-source-host" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOSTS.posthog.map((h) => (
                        <SelectItem key={h.value} value={h.value}>
                          {h.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="error-source-project">Project ID</Label>
                  <Input
                    id="error-source-project"
                    inputMode="numeric"
                    value={projectId}
                    placeholder="698520"
                    onChange={(e) => setProjectId(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="error-source-key">Personal API key</Label>
                <Input
                  id="error-source-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  placeholder={editing ? 'Saved (leave empty to keep it)' : 'phx_…'}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  In PostHog: your avatar → Settings → Personal API keys → Create, with <strong>Query: Read</strong> for this project. Calsko keeps it encrypted and never shows it again.
                </p>
              </div>
            </>
          )}

          {provider === 'sentry' && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="error-source-sentry-host">Region</Label>
                  <Select value={host} onValueChange={(value) => value && setHost(value)}>
                    <SelectTrigger id="error-source-sentry-host" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOSTS.sentry.map((h) => (
                        <SelectItem key={h.value} value={h.value}>
                          {h.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="error-source-org">Organization slug</Label>
                  <Input id="error-source-org" value={org} placeholder="acme" onChange={(e) => setOrg(e.target.value)} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="error-source-sentry-project">Project slug</Label>
                  <Input
                    id="error-source-sentry-project"
                    value={sentryProject}
                    placeholder="web-app"
                    onChange={(e) => setSentryProject(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="error-source-token">Personal auth token</Label>
                <Input
                  id="error-source-token"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  placeholder={editing ? 'Saved (leave empty to keep it)' : 'sntryu_…'}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  In Sentry: User settings → Personal Tokens → Create New Token, with <strong>event:read</strong>, <strong>project:read</strong> and{' '}
                  <strong>org:read</strong>. The slugs are in the project’s address: <span className="font-mono">&lt;org&gt;.sentry.io/projects/&lt;project&gt;/</span>.
                  Calsko keeps the token encrypted and never shows it again.
                </p>
              </div>
            </>
          )}

          <PlanField teamId={team.id} value={plan} onChange={setPlan} newName={newPlanName} onNewNameChange={setNewPlanName} />
          {editing && planChanged && plan !== NO_PLAN && (
            <label className="-mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeExisting} onChange={(e) => setIncludeExisting(e.target.checked)} className="accent-brand" />
              Also add the open issues it already made
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || save.isPending}>
              {save.isPending && <LoaderCircle className="animate-spin" />}
              {editing ? 'Save' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
