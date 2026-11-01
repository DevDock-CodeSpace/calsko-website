// Our own grouping, for sources that don't group errors themselves (the generic webhook without a
// fingerprint; later CloudWatch and Azure logs). Two errors are the same kind when their type, their
// message with the changing parts taken out, and their top frames match:
//   "User 123 not found" and "User 456 not found" → one error;
//   the same crash after a deploy (new line numbers, new bundle hash) → still one error.

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const EMAIL = /\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/gi
const URL_QUERY = /(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/gi
const HEX = /\b(?:0x)?[0-9a-f]{8,}\b/gi
const QUOTED = /(["'`])(?:(?!\1).){1,200}\1/g
const NUMBER = /\b\d+(?:\.\d+)?\b/g

/** The message with ids, numbers, addresses and quoted values replaced, so variants match. */
export function normalizeMessage(message: string): string {
  return message
    .slice(0, 2000)
    .replace(UUID, '<id>')
    .replace(EMAIL, '<email>')
    .replace(URL_QUERY, '$1')
    .replace(HEX, '<hex>')
    .replace(QUOTED, '<str>')
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * A stack's top frames as "function@file", without line numbers, query strings or content hashes
 * (index-4f3a9c1b.js → index.js), so a redeploy doesn't split one error into many.
 */
export function stackSignature(stack: string, frames = 3): string {
  const out: string[] = []
  for (const line of stack.split('\n')) {
    const match =
      line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):\d+(?::\d+)?\)?\s*$/) ?? // V8: at fn (file:1:2)
      line.match(/^\s*(.*?)@(.+?):\d+(?::\d+)?\s*$/) // Firefox/Safari: fn@file:1:2
    if (!match) continue
    const fn = (match[1] ?? '').trim() || '<anon>'
    const file = (match[2] ?? '')
      .replace(/[?#].*$/, '')
      .split('/')
      .pop()!
      .replace(/[-.][0-9a-zA-Z_]{8,}(?=\.\w+$)/, '')
    out.push(`${fn}@${file}`)
    if (out.length === frames) break
  }
  return out.join('|')
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** "cfp_" + 32 hex characters: the same input always gives the same fingerprint. */
export async function fingerprint(parts: { type?: string; message: string; stack?: string }): Promise<string> {
  const key = [(parts.type ?? '').trim().toLowerCase(), normalizeMessage(parts.message), stackSignature(parts.stack ?? '')].join('\n')
  return `cfp_${(await sha256(key)).slice(0, 32)}`
}
