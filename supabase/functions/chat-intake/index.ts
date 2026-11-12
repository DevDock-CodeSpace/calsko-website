// chat-intake: where outside tools post into a chat channel (docs/CHAT_FEEDS.md).
//
//   POST /functions/v1/chat-intake?feed=<feed id>&token=<token>
//   token: ?token= (AWS SNS and Azure action groups can't set headers), header x-calsko-token, or Bearer
//   body: AWS SNS, Azure Monitor (common alert schema), Teams MessageCard, Slack incoming webhook, or
//         Calsko's own { title, text, level, url } (see _shared/chat-feeds/parse.ts)
//   → 200 { posted }  ·  400 unreadable  ·  401 wrong feed/token, feed off, or chat feeds off
//
// One database call per post (the token check), plus the post itself. The database holds each feed to
// 60 messages an hour and counts the rest.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { BadPayload, isConfirmation, parsePost } from '../_shared/chat-feeds/parse.ts'
import { startErrorReporting } from '../_shared/report-errors.ts'

startErrorReporting('chat-intake')

const MAX_BODY_BYTES = 256_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const params = new URL(req.url).searchParams
  const feedId = params.get('feed') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const givenToken = params.get('token') || req.headers.get('x-calsko-token') || bearer || ''
  if (!UUID.test(feedId) || !givenToken) return json({ error: 'unauthorized' }, 401)

  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  let body: unknown
  try {
    // SNS sends JSON as text/plain; read the text whatever the content type says.
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
    body = JSON.parse(text)
  } catch {
    return json({ error: 'bad_request', message: 'Send JSON' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: match, error: matchError } = await admin.rpc('chat_webhook_for_token', { p_feed: feedId, p_token: givenToken })
  if (matchError) {
    console.error('[chat-intake] token check failed', matchError)
    return json({ error: 'failed' }, 500)
  }
  if (!(match as { id: string }[] | null)?.[0]) return json({ error: 'unauthorized' }, 401)

  try {
    let parsed = parsePost(body, req.headers)
    if (isConfirmation(parsed)) {
      // AWS asks the endpoint to prove it wants the topic's messages by visiting this URL (an AWS host).
      const reply = await fetch(parsed.confirm)
      if (!reply.ok) {
        console.error('[chat-intake] SNS confirmation failed', reply.status)
        return json({ error: 'confirmation_failed' }, 502)
      }
      parsed = parsed.post
    }
    const { data, error } = await admin.rpc('chat_webhook_post', {
      p_feed: feedId,
      p_title: parsed.title,
      p_text: parsed.text,
      p_level: parsed.level,
      p_url: parsed.url ?? '',
      p_source: parsed.source,
    })
    if (error) throw error
    // posted: false when the feed is over its hourly limit (the post was counted, not shown).
    return json({ posted: data !== null })
  } catch (e) {
    if (e instanceof BadPayload) return json({ error: 'bad_request', message: e.message }, 400)
    console.error('[chat-intake] post failed', e)
    return json({ error: 'failed' }, 500)
  }
})
