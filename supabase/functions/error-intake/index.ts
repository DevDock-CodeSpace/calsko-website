// error-intake: where error trackers push errors (docs/ERROR_TRACKING.md).
//
//   POST /functions/v1/error-intake?source=<source id>
//   token: header x-calsko-token, or Authorization: Bearer <token>, or ?token= for tools that can't set headers
//   body: the provider's payload (the generic webhook: Calsko's own format, see providers/webhook.ts)
//   → 202 { recorded }  ·  400 unreadable  ·  401 wrong source/token, source off, or error tracking off
//
// It only counts: one small database call per request, no AI and no issue. The daily error-sync run
// writes the issues. Send alerts for new or returning errors (or batches), not one request per occurrence.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { PROVIDERS } from '../_shared/error-tracking/providers/index.ts'
import { BadPayload } from '../_shared/error-tracking/types.ts'
import { startErrorReporting } from '../_shared/report-errors.ts'

startErrorReporting('error-intake')

const MAX_BODY_BYTES = 1_000_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const params = new URL(req.url).searchParams
  const sourceId = params.get('source') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const givenToken = req.headers.get('x-calsko-token') || bearer || params.get('token') || ''
  if (!UUID.test(sourceId) || !givenToken) return json({ error: 'unauthorized' }, 401)

  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
    body = JSON.parse(text)
  } catch {
    return json({ error: 'bad_request', message: 'Send JSON' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: match, error: matchError } = await admin.rpc('error_source_for_token', { p_source: sourceId, p_token: givenToken })
  if (matchError) {
    console.error('[error-intake] token check failed', matchError)
    return json({ error: 'failed' }, 500)
  }
  const source = (match as { id: string; provider: string }[] | null)?.[0]
  if (!source) return json({ error: 'unauthorized' }, 401)
  const provider = PROVIDERS[source.provider]
  if (!provider?.parseWebhook) return json({ error: 'not_a_webhook_source' }, 400)

  try {
    const reports = await provider.parseWebhook(body, new Date())
    const { data, error } = await admin.rpc('error_record', {
      p_source: source.id,
      p_reports: reports.map((r) => ({
        fingerprint: r.fingerprint,
        title: r.title,
        raw: r.raw,
        url: r.url ?? null,
        first_seen: r.firstSeen ?? null,
        last_seen: r.lastSeen ?? null,
        days: r.days,
      })),
    })
    if (error) throw error
    return json({ recorded: (data as { recorded: number }).recorded }, 202)
  } catch (e) {
    if (e instanceof BadPayload) return json({ error: 'bad_request', message: e.message }, 400)
    console.error('[error-intake] record failed', e)
    return json({ error: 'failed' }, 500)
  }
})
