import { webhookUrl } from '../api'
import { CopyField } from './CopyField'

/** Shown once after a webhook source is made or gets a new token: the URL, the token, an example. */
export function WebhookDetails({ sourceId, token }: { sourceId: string; token: string }) {
  const url = webhookUrl(sourceId)
  const example = `curl -X POST '${url}' \\
  -H 'x-calsko-token: ${token}' \\
  -H 'Content-Type: application/json' \\
  -d '{"errors":[{"type":"TypeError","message":"x is undefined","stack":"…","page":"https://…","count":1}]}'`
  return (
    <div className="space-y-3">
      <CopyField label="Webhook URL" value={url} />
      <CopyField label="Token (send it in the x-calsko-token header)" value={token} secret />
      <p className="text-xs text-muted-foreground">
        Copy the token now: Calsko keeps only a fingerprint of it and can’t show it again. Tools that can’t set headers can add{' '}
        <code className="font-mono">&amp;token=…</code> to the URL instead.
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Example request</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">{example}</pre>
      </details>
    </div>
  )
}
