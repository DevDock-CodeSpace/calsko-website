import { useState } from 'react'
import { CopyBlock } from '@/features/errors/components/CopyBlock'
import { CopyField } from '@/features/errors/components/CopyField'
import { cn } from '@/lib/utils'
import { chatWebhookUrl } from '../api'

type Guide = { id: string; label: string; steps: string[]; block?: { label: string; text: string } }

function guides(url: string): Guide[] {
  return [
    {
      id: 'aws',
      label: 'AWS CloudWatch',
      steps: [
        'In Amazon SNS, open the topic your CloudWatch alarms notify (or create one).',
        'Create a subscription: protocol HTTPS, endpoint the URL above. Leave raw message delivery off.',
        'Calsko confirms the subscription by itself; a message where it posts says so.',
        'In each alarm, send “In alarm” and “OK” to that topic. Alarms post in red, recoveries in green.',
      ],
    },
    {
      id: 'azure',
      label: 'Azure Monitor',
      steps: [
        'In Azure Monitor → Alerts → Action groups, create an action group (or edit one).',
        'Under Actions, add a Webhook with the URL above, and set “Enable the common alert schema” to Yes.',
        'Attach the action group to your alert rules. Sev0 and Sev1 post as critical, Sev2 as warning, resolved alerts in green.',
      ],
    },
    {
      id: 'slack',
      label: 'Slack-style tools',
      steps: [
        'Many tools (Grafana, GitHub Actions, Jenkins, Uptime Kuma, Sentry…) can post to a Slack “incoming webhook”.',
        'Paste the URL above where they ask for the Slack webhook URL. Calsko reads the same message format (text and attachments).',
        'Microsoft Teams–style cards (title, text) work too.',
      ],
    },
    {
      id: 'code',
      label: 'Your own code',
      steps: [
        'POST JSON to the URL. Only text (or title) is needed.',
        'level is info, success, warning or critical; critical also notifies everyone who can read where it posts. url adds a “View details” link.',
      ],
      block: {
        label: 'curl',
        text: `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"title": "Disk almost full", "text": "db-1 is at 92%", "level": "warning", "url": "https://example.com/dashboards/db-1"}'`,
      },
    },
  ]
}

/**
 * A webhook's URL (with its secret only right after it's made or replaced: Calsko keeps just a
 * fingerprint) and how to point AWS, Azure, Slack-style tools or a script at it.
 */
export function WebhookSetup({ feedId, token }: { feedId: string; token: string | null }) {
  const url = chatWebhookUrl(feedId, token)
  const shown = token ? url : `${url}&token=<the secret shown when it was made>`
  const all = guides(shown)
  const [open, setOpen] = useState(all[0].id)
  const guide = all.find((g) => g.id === open) ?? all[0]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {token ? (
          <CopyField label="Webhook URL" value={url} secret />
        ) : (
          <p className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">{shown}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {token
            ? 'Copy it now: the URL holds a secret that Calsko keeps only a fingerprint of, so it can’t show it again. Anyone with it can post here.'
            : 'The full URL was shown once, when it was made. If it’s lost, choose New URL in the webhook’s menu.'}
        </p>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Send alerts from">
          <span className="mr-1 text-xs text-muted-foreground">Send alerts from</span>
          {all.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === guide.id}
              onClick={() => setOpen(g.id)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none',
                g.id === guide.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {guide.block && <CopyBlock label={guide.block.label} text={guide.block.text} />}
      </div>
    </div>
  )
}
