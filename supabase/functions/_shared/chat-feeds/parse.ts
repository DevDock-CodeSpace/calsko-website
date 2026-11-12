// What outside tools post to a chat webhook (docs/CHAT_FEEDS.md), turned into one chat message.
//
// Understood, in this order:
//   · AWS SNS (CloudWatch alarms, or any SNS notification); subscription confirmations are answered;
//   · Azure Monitor's common alert schema;
//   · Microsoft Teams–style MessageCards;
//   · Slack incoming-webhook messages (text, attachments, section blocks);
//   · Calsko's own: { title?, text?, level?, url? } (also `message` instead of `text`).

export type Level = 'info' | 'success' | 'warning' | 'critical'

export type ChatPost = { title: string; text: string; level: Level; url: string | null; source: string }

/** An SNS subscription to confirm: fetch `subscribeUrl` (checked to be AWS's), then post `post`. */
export type SnsConfirmation = { confirm: string; post: ChatPost }

export class BadPayload extends Error {}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const httpUrl = (v: unknown) => {
  const s = str(v)
  return /^https?:\/\/\S+$/i.test(s) ? s : null
}
const LEVELS: Level[] = ['info', 'success', 'warning', 'critical']

/** Only AWS's own SNS hosts may be fetched to confirm a subscription. */
export function isSnsHost(url: string) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname)
  } catch {
    return false
  }
}

/** Slack's markup: <url|label> → label, <url> → url, <!here> → @here; the first link is kept apart. */
export function fromSlackMarkup(text: string): { text: string; url: string | null } {
  let url: string | null = null
  const out = text
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:\/\/[^|>\s]+)(?:\|([^>]*))?>/g, (_m, link: string, label?: string) => {
      url ??= link
      return label?.trim() ? label : link
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  return { text: out, url }
}

function cloudWatch(alarm: Obj): ChatPost {
  const name = str(alarm.AlarmName) || 'CloudWatch alarm'
  const state = str(alarm.NewStateValue)
  const level: Level = state === 'ALARM' ? 'critical' : state === 'OK' ? 'success' : 'warning'
  const region = /^arn:aws[a-z-]*:cloudwatch:([a-z0-9-]+):/.exec(str(alarm.AlarmArn))?.[1]
  const lines = [
    str(alarm.NewStateReason),
    str(alarm.AlarmDescription) && `About: ${str(alarm.AlarmDescription)}`,
    [str(alarm.Region), str(alarm.AWSAccountId) && `account ${str(alarm.AWSAccountId)}`].filter(Boolean).join(' · '),
  ].filter(Boolean)
  return {
    title: `${name}: ${state === 'ALARM' ? 'in alarm' : state === 'OK' ? 'back to OK' : state === 'INSUFFICIENT_DATA' ? 'insufficient data' : state || 'changed'}`,
    text: lines.join('\n'),
    level,
    url: region ? `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(name)}` : null,
    source: 'aws',
  }
}

function sns(body: Obj): ChatPost | SnsConfirmation {
  const type = str(body.Type)
  const topic = str(body.TopicArn).split(':').pop() || 'an SNS topic'
  if (type === 'SubscriptionConfirmation') {
    const confirm = str(body.SubscribeURL)
    if (!isSnsHost(confirm)) throw new BadPayload('That subscription URL isn’t from AWS SNS')
    return { confirm, post: { title: `Connected to AWS SNS topic ${topic}`, text: 'Its notifications will appear here.', level: 'success', url: null, source: 'aws' } }
  }
  if (type === 'UnsubscribeConfirmation') {
    return { title: `Unsubscribed from AWS SNS topic ${topic}`, text: '', level: 'warning', url: null, source: 'aws' }
  }
  const message = str(body.Message)
  try {
    const inner: unknown = JSON.parse(message)
    if (isObj(inner) && 'AlarmName' in inner) return cloudWatch(inner)
  } catch {
    // Not JSON: a plain SNS message.
  }
  return { title: str(body.Subject) || `AWS SNS · ${topic}`, text: message, level: 'info', url: null, source: 'aws' }
}

function azure(body: Obj): ChatPost {
  const data = isObj(body.data) ? body.data : {}
  const e = isObj(data.essentials) ? data.essentials : {}
  const sev = str(e.severity)
  const resolved = str(e.monitorCondition) === 'Resolved'
  const level: Level = resolved ? 'success' : sev === 'Sev0' || sev === 'Sev1' ? 'critical' : sev === 'Sev2' ? 'warning' : 'info'
  const targets = Array.isArray(e.alertTargetIDs) ? e.alertTargetIDs.map((t) => str(t).split('/').pop()).filter(Boolean) : []
  const lines = [
    str(e.description),
    [sev, str(e.signalType), targets.length ? `on ${targets.join(', ')}` : ''].filter(Boolean).join(' · '),
  ].filter(Boolean)
  return {
    title: `${str(e.alertRule) || 'Azure alert'}: ${resolved ? 'resolved' : 'fired'}`,
    text: lines.join('\n'),
    level,
    url: 'https://portal.azure.com/#view/Microsoft_Azure_Monitoring/AzureMonitoringBrowseBlade/~/alertsV2',
    source: 'azure',
  }
}

function teamsCard(body: Obj): ChatPost {
  const sections = Array.isArray(body.sections) ? body.sections.filter(isObj) : []
  const actions = Array.isArray(body.potentialAction) ? body.potentialAction.filter(isObj) : []
  const target = actions.flatMap((a) => (Array.isArray(a.targets) ? a.targets.filter(isObj).map((t) => t.uri) : [a.target]))
  return {
    title: str(body.title) || str(body.summary),
    text: [str(body.text), ...sections.map((s) => [str(s.activityTitle), str(s.text)].filter(Boolean).join('\n'))].filter(Boolean).join('\n'),
    level: 'info',
    url: target.map(httpUrl).find(Boolean) ?? null,
    source: 'teams',
  }
}

function slack(body: Obj): ChatPost {
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter(isObj) : []
  const blocks = Array.isArray(body.blocks) ? body.blocks.filter(isObj) : []
  const blockText = blocks.flatMap((b) => {
    const parts: string[] = []
    if (isObj(b.text)) parts.push(str(b.text.text))
    if (Array.isArray(b.fields)) parts.push(...b.fields.filter(isObj).map((f) => str(f.text)))
    return parts.filter(Boolean)
  })
  const color = attachments.map((a) => str(a.color).toLowerCase()).find(Boolean) ?? ''
  const level: Level = color === 'danger' || color === '#ff0000' ? 'critical' : color === 'warning' ? 'warning' : color === 'good' ? 'success' : 'info'
  const pieces = [
    str(body.text) || blockText.join('\n'),
    ...attachments.map((a) => [str(a.pretext), str(a.title), str(a.text) || (!str(a.title) ? str(a.fallback) : '')].filter(Boolean).join('\n')),
  ].filter(Boolean)
  const { text, url } = fromSlackMarkup(pieces.join('\n'))
  const [first, ...rest] = text.split('\n')
  return {
    // A short first line reads as the title; a long one stays text.
    title: rest.length > 0 && first.length <= 150 ? first : '',
    text: rest.length > 0 && first.length <= 150 ? rest.join('\n') : text,
    level,
    url: url ?? attachments.map((a) => httpUrl(a.title_link)).find(Boolean) ?? null,
    source: 'slack',
  }
}

/** What was posted, as a chat message (or an SNS subscription to confirm first). */
export function parsePost(body: unknown, headers: Headers): ChatPost | SnsConfirmation {
  if (!isObj(body)) throw new BadPayload('Send a JSON object')
  if (headers.get('x-amz-sns-message-type') || (str(body.TopicArn) && str(body.Type))) return sns(body)
  if (body.schemaId === 'azureMonitorCommonAlertSchema') return azure(body)
  if (body['@type'] === 'MessageCard') return teamsCard(body)
  if (Array.isArray(body.attachments) || Array.isArray(body.blocks)) return slack(body)
  if ('level' in body || 'title' in body || 'message' in body) {
    const level = str(body.level).toLowerCase() as Level
    return {
      title: str(body.title),
      text: str(body.text) || str(body.message),
      level: LEVELS.includes(level) ? level : 'info',
      url: httpUrl(body.url),
      source: 'calsko',
    }
  }
  if ('text' in body) return slack(body)
  throw new BadPayload('Send text (or title), or a Slack, Teams, AWS SNS or Azure Monitor alert')
}

export const isConfirmation = (p: ChatPost | SnsConfirmation): p is SnsConfirmation => 'confirm' in p
