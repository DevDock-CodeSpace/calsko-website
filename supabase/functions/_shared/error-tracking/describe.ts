// Writes the issue for a new error: by AI when the group has error_tracking_ai on, from a plain template
// otherwise or when the AI fails. Either way the exact error is copied below, word for word, in a code
// block: the AI only adds a reading of it, it never replaces it.
//
// The description is TipTap JSON in the schema the issue editor uses (paragraph, heading, bulletList,
// codeBlock, link marks).

import type { AiProvider } from '../../ai-agent/agent/types.ts'

export type NewError = {
  title: string
  raw: string
  url: string | null
  firstSeen: string
  lastSeen: string
  totalCount: number
  /** "QB-12" when this error came back after that issue was Done. */
  cameBackAfter: string | null
}

export type WrittenIssue = {
  title: string
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low (issues.priority). */
  priority: number
  description: Record<string, unknown>
  byAi: boolean
}

type Node = Record<string, unknown>
const textNode = (text: string, marks?: Node[]): Node => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const paragraph = (...content: Node[]): Node => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const heading = (text: string): Node => ({ type: 'heading', attrs: { level: 3 }, content: [textNode(text)] })
const bullets = (items: string[]): Node => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [paragraph(textNode(item))] })),
})
const codeBlock = (text: string): Node => ({ type: 'codeBlock', attrs: { language: null }, content: text ? [textNode(text)] : [] })

const date = (iso: string) => iso.slice(0, 10)

/** The part every issue has: the exact error, then where it came from. */
function errorSection(error: NewError, providerLabel: string): Node[] {
  const times = `${error.totalCount.toLocaleString('en-US')} ${error.totalCount === 1 ? 'time' : 'times'}`
  const when = date(error.firstSeen) === date(error.lastSeen) ? `on ${date(error.lastSeen)}` : `between ${date(error.firstSeen)} and ${date(error.lastSeen)}`
  const facts = `Seen ${times} ${when} when this issue was made.`
  return [
    heading('Error'),
    codeBlock(error.raw || error.title),
    paragraph(
      textNode(`${facts} `),
      ...(error.url ? [textNode(`Open in ${providerLabel}`, [{ type: 'link', attrs: { href: error.url } }])] : []),
    ),
  ]
}

const cameBack = (error: NewError): Node[] =>
  error.cameBackAfter ? [paragraph(textNode(`This error came back after ${error.cameBackAfter} was marked Done.`, [{ type: 'bold' }]))] : []

export function templateIssue(error: NewError, providerLabel: string, sourceName = providerLabel): WrittenIssue {
  return {
    title: error.title.slice(0, 200),
    priority: 0,
    byAi: false,
    description: {
      type: 'doc',
      content: [...cameBack(error), paragraph(textNode(`Calsko found this error in ${sourceName}.`)), ...errorSection(error, providerLabel)],
    },
  }
}

const SYSTEM = `You turn an error report from an error tracker into an issue for a software team's issue tracker.

Reply with one JSON object and nothing else:
{"title": string, "summary": string, "cause": string, "where": string[], "priority": "urgent" | "high" | "medium" | "low"}

- title: at most 90 characters, plain words, says what is broken from the user's side when the report shows it ("Checkout crashes when the coupon field is empty"), otherwise what fails ("Saving a draft throws 'x is undefined'"). No ticket prefixes, no quotes around it.
- summary: 1–3 sentences: what happens, where (page or function), how often.
- cause: 1–3 sentences on the most likely cause, read from the message and the stack. Say "likely" or "possibly"; if the report doesn't show enough, say what is missing.
- where: 1–4 short pointers to look at first: files and functions from the stack frames that belong to the app (not node_modules, not the browser, not minified vendor bundles), or the page.
- priority: urgent when it breaks something central for many people (sign-in, payment, data loss) and happens a lot; high when a main feature fails; medium for a contained failure; low for noise (browser extensions, aborted requests, ResizeObserver loop).

Use only what the report shows. Never invent file names, line numbers or numbers. Never repeat secrets, tokens, passwords or email addresses that appear in the report.`

const PRIORITY: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4 }

/** The model's reply → the fields, or null when it isn't what we asked for. */
export function parseAiReply(text: string | null): { title: string; summary: string; cause: string; where: string[]; priority: number } | null {
  if (!text) return null
  const json = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  let value: unknown
  try {
    value = JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const s = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const title = s(v.title, 120)
  const summary = s(v.summary, 800)
  if (!title || !summary) return null
  return {
    title,
    summary,
    cause: s(v.cause, 800),
    where: Array.isArray(v.where) ? v.where.map((w) => s(w, 200)).filter(Boolean).slice(0, 4) : [],
    priority: PRIORITY[s(v.priority, 10).toLowerCase()] ?? 0,
  }
}

function prompt(error: NewError): string {
  return [
    `Error: ${error.title}`,
    `Occurrences: ${error.totalCount} (first ${error.firstSeen}, last ${error.lastSeen})`,
    error.cameBackAfter ? `It came back after issue ${error.cameBackAfter} was marked Done.` : '',
    '',
    'Report:',
    error.raw.slice(0, 8000),
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export async function aiIssue(ai: AiProvider, error: NewError, providerLabel: string): Promise<WrittenIssue | null> {
  const reply = await ai.run({
    system: SYSTEM,
    messages: [{ role: 'user', text: prompt(error) }],
    tools: [],
    signal: AbortSignal.timeout(30_000),
  })
  const fields = parseAiReply(reply.text)
  if (!fields) return null
  const content: Node[] = [...cameBack(error), paragraph(textNode(fields.summary))]
  if (fields.cause) content.push(heading('Likely cause'), paragraph(textNode(fields.cause)))
  if (fields.where.length) content.push(heading('Where to look'), bullets(fields.where))
  content.push(...errorSection(error, providerLabel))
  content.push(paragraph(textNode('The text above the error was written by AI from the report; check it before relying on it.', [{ type: 'italic' }])))
  return { title: fields.title, priority: fields.priority, byAi: true, description: { type: 'doc', content } }
}
