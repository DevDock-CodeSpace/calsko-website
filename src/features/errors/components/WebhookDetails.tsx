import { useState } from 'react'
import { cn } from '@/lib/utils'
import { webhookUrl } from '../api'
import { webhookGuides, type WebhookGuide } from '../webhookGuides'
import { CopyBlock } from './CopyBlock'
import { CopyField } from './CopyField'

/**
 * A webhook source's URL, its token (only right after it's made or replaced: Calsko keeps just a
 * fingerprint), and how to send errors to it from your own code, Datadog or New Relic.
 */
export function WebhookDetails({ sourceId, token }: { sourceId: string; token: string | null }) {
  const url = webhookUrl(sourceId)
  const guides = webhookGuides(url, token ?? '<your token>')
  const [open, setOpen] = useState<WebhookGuide['id']>('code')
  const guide = guides.find((g) => g.id === open) ?? guides[0]

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <CopyField label="Webhook URL" value={url} />
        {token && <CopyField label="Token (send it in the x-calsko-token header)" value={token} secret />}
        <p className="text-xs text-muted-foreground">
          {token
            ? 'Copy the token now: Calsko keeps only a fingerprint of it and can’t show it again.'
            : 'The token was shown once, when it was made. If it’s lost, make a new one from the source’s menu.'}{' '}
          Tools that can’t set headers can add <code className="font-mono">&amp;token=…</code> to the URL instead.
        </p>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Send errors from">
          <span className="mr-1 text-xs text-muted-foreground">Send errors from</span>
          {guides.map((g) => (
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
        {guide.blocks.map((block) => (
          <CopyBlock key={block.label} label={block.label} text={block.text} />
        ))}
      </div>
    </div>
  )
}
