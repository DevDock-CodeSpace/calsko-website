// npm run test:errors — the error-tracking pipeline without a database or network.

import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1'
import { aiIssue, parseAiReply, templateIssue, type NewError } from './describe.ts'
import { fingerprint, normalizeMessage, stackSignature } from './fingerprint.ts'
import { buildQuery, exceptionText, posthogProvider, rowToReport } from './providers/posthog.ts'
import { eventText, issueToReport, nextCursor, sentryProvider } from './providers/sentry.ts'
import { parseCalskoWebhook, rawText } from './providers/webhook.ts'
import { BadPayload, mergeReports, SourceProblem } from './types.ts'
import { webhookGuides } from '../../../../src/features/errors/webhookGuides.ts'

const NOW = new Date('2026-11-01T12:00:00Z')

Deno.test('normalizeMessage takes out ids, numbers, addresses and quoted values', () => {
  assertEquals(normalizeMessage('User 123 not found'), normalizeMessage('User 456 not found'))
  assertEquals(
    normalizeMessage('Order 3f2b8c1e-1d2a-4c3b-9a8b-112233445566 failed for a@b.com'),
    'order <id> failed for <email>',
  )
  assertEquals(normalizeMessage(`Cannot read 'name' of undefined`), normalizeMessage(`Cannot read 'title' of undefined`))
  assertNotEquals(normalizeMessage('Cannot read name'), normalizeMessage('Network error'))
})

Deno.test('stackSignature ignores line numbers and bundle hashes', () => {
  const before = 'TypeError: x\n    at saveDraft (https://app.test/assets/index-4f3a9c1b.js:12:345)\n    at onClick (https://app.test/assets/index-4f3a9c1b.js:99:1)'
  const after = 'TypeError: x\n    at saveDraft (https://app.test/assets/index-a8b7c6d5.js:13:2)\n    at onClick (https://app.test/assets/index-a8b7c6d5.js:101:7)'
  assertEquals(stackSignature(before), 'saveDraft@index.js|onClick@index.js')
  assertEquals(stackSignature(before), stackSignature(after))
  assertEquals(stackSignature('saveDraft@https://app.test/main.js:1:2'), 'saveDraft@main.js')
})

Deno.test('fingerprint is stable and groups variants', async () => {
  const a = await fingerprint({ type: 'NotFound', message: 'User 1 not found' })
  const b = await fingerprint({ type: 'NotFound', message: 'User 2 not found' })
  const c = await fingerprint({ type: 'NotFound', message: 'Team 2 not found' })
  assertEquals(a, b)
  assertNotEquals(a, c)
  assert(/^cfp_[0-9a-f]{32}$/.test(a))
})

Deno.test('webhook: one error, a list, counts and fingerprints', async () => {
  const one = await parseCalskoWebhook({ type: 'TypeError', message: 'x is undefined', stack: 'at f (a.js:1:2)', page: 'https://app.test/cart' }, NOW)
  assertEquals(one.length, 1)
  assertEquals(one[0].title, 'TypeError: x is undefined')
  assertEquals(one[0].days, [{ day: '2026-11-01', count: 1 }])
  assert(one[0].raw.includes('Page: https://app.test/cart'))

  const many = await parseCalskoWebhook(
    {
      errors: [
        { message: 'User 1 not found', count: 3, timestamp: '2026-10-31T10:00:00Z' },
        { message: 'User 2 not found', count: 2 },
        { title: 'Checkout failed', fingerprint: 'chk', link: 'https://tracker.test/1' },
      ],
    },
    NOW,
  )
  assertEquals(many.length, 2)
  const users = many.find((r) => r.title.startsWith('User'))!
  assertEquals(users.days.reduce((s, d) => s + d.count, 0), 5)
  assertEquals(users.days.length, 2)
  const checkout = many.find((r) => r.title === 'Checkout failed')!
  assertEquals(checkout.fingerprint, 'ext_chk')
  assertEquals(checkout.url, 'https://tracker.test/1')
})

Deno.test('webhook: refuses what it cannot read', async () => {
  await assertRejects(() => parseCalskoWebhook('nope', NOW), BadPayload)
  await assertRejects(() => parseCalskoWebhook({ errors: [{ count: 2 }] }, NOW), BadPayload)
  await assertRejects(() => parseCalskoWebhook({ errors: Array.from({ length: 101 }, () => ({ message: 'x' })) }, NOW), BadPayload)
  // A future or ancient timestamp counts as now; a non-https link is dropped.
  const [r] = await parseCalskoWebhook({ message: 'x', timestamp: '2030-01-01T00:00:00Z', link: 'http://insecure.test' }, NOW)
  assertEquals(r.days[0].day, '2026-11-01')
  assertEquals(r.url, undefined)
})

Deno.test('rawText keeps the error word for word', () => {
  const raw = rawText({ type: 'Error', message: 'Boom <b>', stack: 'at x (y.js:1:1)', environment: 'production', details: { userAgent: 'UA' } })
  assert(raw.startsWith('Error: Boom <b>\nat x (y.js:1:1)'))
  // A V8 stack already starts with the message: printed once.
  const v8 = rawText({ type: 'TypeError', message: 'x', stack: 'TypeError: x\n    at f (a.js:1:1)' })
  assertEquals(v8, 'TypeError: x\n    at f (a.js:1:1)')
  assert(raw.includes('Environment: production'))
  assert(raw.includes('"userAgent": "UA"'))
})

Deno.test('mergeReports adds days and keeps the latest sample', () => {
  const merged = mergeReports([
    { fingerprint: 'f', title: 'old', raw: 'old raw', lastSeen: '2026-10-30T00:00:00Z', firstSeen: '2026-10-30T00:00:00Z', days: [{ day: '2026-10-30', count: 2 }] },
    { fingerprint: 'f', title: 'new', raw: 'new raw', lastSeen: '2026-10-31T00:00:00Z', firstSeen: '2026-10-31T00:00:00Z', days: [{ day: '2026-10-30', count: 1 }, { day: '2026-10-31', count: 4 }] },
  ])
  assertEquals(merged.length, 1)
  assertEquals(merged[0].title, 'new')
  assertEquals(merged[0].firstSeen, '2026-10-30T00:00:00Z')
  assertEquals(merged[0].days, [{ day: '2026-10-30', count: 3 }, { day: '2026-10-31', count: 4 }])
})

// ---------------------------------------------------------------- PostHog

const ISSUE = '0192f1a2-1111-7222-8333-944455556666'
const LIST = JSON.stringify([
  {
    type: 'TypeError',
    value: "Cannot read properties of undefined (reading 'total')",
    stacktrace: {
      frames: [
        { function: 'onClick', filename: 'https://www.calsko.com/assets/index-abc.js', lineno: 9, colno: 1, in_app: true },
        { resolved_name: 'applyCoupon', source: 'src/features/cart/coupon.ts', line: 42, column: 7, in_app: true },
      ],
    },
  },
])

Deno.test('posthog: rows become reports with the stack innermost first', () => {
  const report = rowToReport(
    [ISSUE, '2026-10-31', 12, '2026-10-31 08:00:00', '2026-10-31 20:00:00', LIST, '[]', '[]', 'https://www.calsko.com/t/x/cart', 'Chrome', 'Mac OS X', 3],
    { host: 'https://us.posthog.com', projectId: '698520' },
  )!
  assertEquals(report.fingerprint, `ph_${ISSUE}`)
  assertEquals(report.title, "TypeError: Cannot read properties of undefined (reading 'total')")
  assertEquals(report.url, `https://us.posthog.com/project/698520/error_tracking/${ISSUE}`)
  assertEquals(report.days, [{ day: '2026-10-31', count: 12 }])
  assertEquals(report.people, 3)
  assertEquals(report.lastSeen, '2026-10-31T20:00:00.000Z')
  const lines = report.raw.split('\n')
  assertEquals(lines[1], '    at applyCoupon (src/features/cart/coupon.ts:42:7)')
  assertEquals(lines[2], '    at onClick (https://www.calsko.com/assets/index-abc.js:9:1)')
  assert(report.raw.includes('Browser: Chrome · Mac OS X'))
})

Deno.test('posthog: falls back to types and values, skips empty rows', () => {
  assertEquals(exceptionText(null, '["RangeError"]', '["Too deep"]').title, 'RangeError: Too deep')
  assertEquals(rowToReport(['', '2026-10-31', 0], { host: 'https://us.posthog.com', projectId: '1' }), null)
  const noId = rowToReport(['', '2026-10-31', 1, '', '', null, '["E"]', '["m"]'], { host: 'https://us.posthog.com', projectId: '1' })!
  assertEquals(noId.fingerprint, 'ph_title_E: m')
  assertEquals(noId.url, undefined)
  assertEquals(noId.people, undefined)
})

Deno.test('posthog: the query covers exactly the window, in UTC', () => {
  const q = buildQuery(new Date('2026-10-31T06:00:00Z'), new Date('2026-11-01T06:00:00Z'))
  assert(q.includes("timestamp > toDateTime('2026-10-31 06:00:00', 'UTC')"))
  assert(q.includes("timestamp <= toDateTime('2026-11-01 06:00:00', 'UTC')"))
  assert(q.includes('uniq(distinct_id) AS people'))
})

Deno.test('merging keeps the most people any report saw', () => {
  const day = (d: string) => [{ day: d, count: 1 }]
  const [merged] = mergeReports([
    { fingerprint: 'f', title: 'E', raw: '', days: day('2026-10-30'), people: 1 },
    { fingerprint: 'f', title: 'E', raw: '', days: day('2026-10-31'), people: 4 },
    { fingerprint: 'f', title: 'E', raw: '', days: day('2026-11-01') },
  ])
  assertEquals(merged.people, 4)
})

Deno.test('posthog: pull merges days per issue and explains a refused key', async () => {
  const rows = [
    [ISSUE, '2026-10-31', 3, '2026-10-31 08:00:00', '2026-10-31 09:00:00', LIST, '[]', '[]', '', '', ''],
    [ISSUE, '2026-11-01', 2, '2026-11-01 01:00:00', '2026-11-01 02:00:00', LIST, '[]', '[]', '', '', ''],
  ]
  let sent: RequestInit | undefined
  const ok = (async (_url: string, init: RequestInit) => {
    sent = init
    return new Response(JSON.stringify({ results: rows }))
  }) as unknown as typeof fetch
  const context = { config: { host: 'https://us.posthog.com', project_id: '698520' }, apiKey: 'phx_test', since: NOW, until: NOW }
  const reports = await posthogProvider.pull!({ ...context, fetch: ok })
  assertEquals(reports.length, 1)
  assertEquals(reports[0].days.reduce((s, d) => s + d.count, 0), 5)
  assertEquals((sent!.headers as Record<string, string>).Authorization, 'Bearer phx_test')

  const refused = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch
  await assertRejects(() => posthogProvider.pull!({ ...context, fetch: refused }), SourceProblem, 'needs the "Query: Read" scope')
  // PostHog's own reason is passed on when it gives one.
  const scoped = (async () =>
    new Response(JSON.stringify({ type: 'authentication_error', detail: "API key missing required scope 'query:read'" }), { status: 403 })) as unknown as typeof fetch
  await assertRejects(() => posthogProvider.pull!({ ...context, fetch: scoped }), SourceProblem, "PostHog refused the API key: API key missing required scope 'query:read'")
})

// ---------------------------------------------------------------- issue text

const ERROR: NewError = {
  title: 'TypeError: x is undefined',
  raw: 'TypeError: x is undefined\n    at applyCoupon (coupon.ts:42:7)',
  url: 'https://us.posthog.com/project/1/error_tracking/abc',
  firstSeen: '2026-10-30T08:00:00Z',
  lastSeen: '2026-11-01T08:00:00Z',
  totalCount: 1532,
  cameBackAfter: null,
}

const textOf = (doc: unknown): string => JSON.stringify(doc)

Deno.test('template: the exact error in a code block, with the link', () => {
  const issue = templateIssue(ERROR, 'PostHog')
  assertEquals(issue.title, ERROR.title)
  assertEquals(issue.byAi, false)
  const content = (issue.description as { content: { type: string; content?: { text: string }[] }[] }).content
  const code = content.find((n) => n.type === 'codeBlock')!
  assertEquals(code.content![0].text, ERROR.raw)
  assert(textOf(issue.description).includes('Seen 1,532 times between 2026-10-30 and 2026-11-01'))
  assert(textOf(templateIssue({ ...ERROR, firstSeen: ERROR.lastSeen }, 'PostHog').description).includes('Seen 1,532 times on 2026-11-01'))
  assert(textOf(templateIssue(ERROR, 'the webhook', 'Sentry alerts').description).includes('found this error in Sentry alerts'))
  assert(textOf(issue.description).includes('Open in PostHog'))
  assert(textOf(templateIssue({ ...ERROR, cameBackAfter: 'QB-12' }, 'PostHog').description).includes('came back after QB-12'))
})

Deno.test('parseAiReply reads JSON, fenced or not, and rejects the rest', () => {
  const reply = parseAiReply('```json\n{"title":"Coupon crashes checkout","summary":"It fails.","cause":"Likely null.","where":["coupon.ts"],"priority":"high"}\n```')!
  assertEquals(reply.title, 'Coupon crashes checkout')
  assertEquals(reply.priority, 2)
  assertEquals(reply.where, ['coupon.ts'])
  assertEquals(parseAiReply('not json'), null)
  assertEquals(parseAiReply('{"title":"no summary"}'), null)
  assertEquals(parseAiReply('{"title":"t","summary":"s","priority":"whenever"}')!.priority, 0)
})

Deno.test('aiIssue: AI text above, the exact error below; null when the reply is unusable', async () => {
  const fake = (text: string | null) => ({
    name: 'fake',
    model: 'fake',
    run: async () => ({ text, toolCalls: [] }),
  })
  const issue = (await aiIssue(
    fake('{"title":"Coupon crashes checkout","summary":"Checkout fails when a coupon is applied.","cause":"Likely the cart total is missing.","where":["applyCoupon in coupon.ts"],"priority":"urgent"}'),
    ERROR,
    'PostHog',
  ))!
  assertEquals(issue.title, 'Coupon crashes checkout')
  assertEquals(issue.priority, 1)
  const types = (issue.description as { content: { type: string }[] }).content.map((n) => n.type)
  assertEquals(types, ['paragraph', 'heading', 'paragraph', 'heading', 'bulletList', 'heading', 'codeBlock', 'paragraph', 'paragraph'])
  assert(textOf(issue.description).includes(JSON.stringify(ERROR.raw).slice(1, -1)))
  assertEquals(await aiIssue(fake('sorry'), ERROR, 'PostHog'), null)
})

// ---------------------------------------------------------------- Sentry

const DAY = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

const SENTRY_ISSUE = {
  id: '4821',
  title: "TypeError: Cannot read properties of undefined (reading 'total')",
  culprit: 'applyCoupon(src/cart/coupon)',
  permalink: 'https://acme.sentry.io/issues/4821/',
  firstSeen: '2026-10-20T08:00:00Z',
  lastSeen: '2026-11-01T09:00:00Z',
  count: '12',
  lifetime: { count: '340' },
  userCount: 5,
  stats: { '14d': [[DAY('2026-10-29'), 7], [DAY('2026-10-30'), 0], [DAY('2026-10-31'), 5], [DAY('2026-11-01'), 7]] as [number, number][] },
}

Deno.test('sentry: an issue becomes a report with whole-day counts from the sync window', () => {
  const report = issueToReport(SENTRY_ISSUE, new Date('2026-10-31T06:00:00Z'))!
  assertEquals(report.fingerprint, 'sentry_4821')
  assertEquals(report.people, 5)
  assertEquals(report.daysMode, 'set')
  assertEquals(report.days, [{ day: '2026-10-31', count: 5 }, { day: '2026-11-01', count: 7 }])
  assertEquals(report.total, 340)
  assertEquals(report.url, 'https://acme.sentry.io/issues/4821/')
  assert(report.raw.includes('at applyCoupon(src/cart/coupon)'))
  assertEquals(issueToReport({ title: 'no id' }, NOW), null)
})

Deno.test('sentry: next page from the Link header only while it has results', () => {
  const link =
    '<https://sentry.io/api/0/x/?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", ' +
    '<https://sentry.io/api/0/x/?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"'
  assertEquals(nextCursor(link), '0:100:0')
  assertEquals(nextCursor(link.replace('results="true"', 'results="false"')), null)
  assertEquals(nextCursor(null), null)
})

const SENTRY_EVENT = {
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'total')",
            stacktrace: {
              frames: [
                { function: 'onSubmit', filename: 'src/cart/Checkout.tsx', lineNo: 88, colNo: 5 },
                { function: 'applyCoupon', filename: 'src/cart/coupon.ts', lineNo: 42, colNo: 7 },
              ],
            },
          },
        ],
      },
    },
    { type: 'request', data: { url: 'https://shop.test/checkout' } },
  ],
  tags: [{ key: 'browser', value: 'Chrome 130' }, { key: 'environment', value: 'production' }, { key: 'release', value: '2.15.0' }],
}

Deno.test('sentry: the latest event becomes the exact error, innermost frame first', () => {
  const raw = eventText(SENTRY_EVENT, 'fallback')
  const lines = raw.split('\n')
  assertEquals(lines[0], "TypeError: Cannot read properties of undefined (reading 'total')")
  assertEquals(lines[1], '    at applyCoupon (src/cart/coupon.ts:42:7)')
  assertEquals(lines[2], '    at onSubmit (src/cart/Checkout.tsx:88:5)')
  assert(raw.includes('Page: https://shop.test/checkout'))
  assert(raw.includes('Environment: production'))
  assertEquals(eventText({}, 'Just the title'), 'Just the title')
})

Deno.test('sentry: pull reads the project, pages issues and fills in the latest event', async () => {
  const calls: string[] = []
  const fake = (async (url: string) => {
    calls.push(url)
    if (url.includes('/projects/acme/web/')) return new Response(JSON.stringify({ id: '77' }))
    if (url.includes('/events/latest/')) return new Response(JSON.stringify(SENTRY_EVENT))
    if (url.includes('cursor=0%3A100%3A0')) return new Response(JSON.stringify([{ ...SENTRY_ISSUE, id: '9' }]), { headers: { link: '' } })
    return new Response(JSON.stringify([SENTRY_ISSUE]), {
      headers: { link: '<x>; rel="next"; results="true"; cursor="0:100:0"' },
    })
  }) as unknown as typeof fetch
  const reports = await sentryProvider.pull!({
    config: { host: 'https://de.sentry.io', org: 'acme', project: 'web' },
    apiKey: 'sntryu_test',
    since: new Date('2026-10-31T06:00:00Z'),
    until: NOW,
    fetch: fake,
  })
  assertEquals(reports.map((r) => r.fingerprint), ['sentry_4821', 'sentry_9'])
  assert(reports[0].raw.startsWith('TypeError'))
  const list = calls.find((c) => c.includes('/organizations/acme/issues/?'))!
  assert(list.startsWith('https://de.sentry.io/'))
  assert(list.includes('project=77') && list.includes('groupStatsPeriod=14d') && list.includes('query=&'))

  const refused = (async () => new Response(JSON.stringify({ detail: 'Invalid token' }), { status: 401 })) as unknown as typeof fetch
  await assertRejects(
    () => sentryProvider.pull!({ config: { org: 'acme', project: 'web' }, apiKey: 'x', since: NOW, until: NOW, fetch: refused }),
    SourceProblem,
    'Sentry refused the token: Invalid token',
  )
})

// ---------------------------------------------------------------- Datadog and New Relic guides

Deno.test('guides: the Datadog and New Relic templates, filled in by those tools, are errors Calsko reads', async () => {
  const guides = webhookGuides('https://x.supabase.co/functions/v1/error-intake?source=s', 'cerr_t')
  const payload = (id: string) => guides.find((g) => g.id === id)!.blocks.find((b) => /payload/i.test(b.label))!.text
  const ms = NOW.getTime() - 60_000

  // Datadog substitutes $VARIABLES as text.
  const datadog = payload('datadog')
    .replace('$ALERT_TITLE', 'Checkout error rate is high')
    .replace('$TEXT_ONLY_MSG', 'TypeError: x is undefined at applyCoupon')
    .replace('$AGGREG_KEY', '9bd4ac313a4d1e8fae2482df7b77628')
    .replace('$LINK', 'https://app.datadoghq.com/monitors/1234')
    .replace('$DATE', String(ms))
    .replace('$TAGS[env]', 'production')
    .replace('$ALERT_ID', '1234').replace('$ALERT_TRANSITION', 'Triggered').replace('$ALERT_PRIORITY', 'P2').replace('$TAGS', 'env:production,service:checkout')
  const [dd] = await parseCalskoWebhook(JSON.parse(datadog), NOW)
  assertEquals(dd.title, 'Checkout error rate is high')
  assertEquals(dd.fingerprint, 'ext_9bd4ac313a4d1e8fae2482df7b77628')
  assertEquals(dd.url, 'https://app.datadoghq.com/monitors/1234')
  assertEquals(dd.lastSeen, new Date(ms).toISOString())
  assert(dd.raw.includes('Environment: production') && dd.raw.includes('Datadog monitor 1234'))

  // New Relic renders Handlebars; {{json x}} writes a JSON value.
  const values: Record<string, unknown> = {
    issueTitle: 'High error rate on checkout-api',
    'accumulations.conditionName.[0]': 'Error rate > 5%',
    issuePageUrl: 'https://radar-api.service.newrelic.com/accounts/1/issues/abc',
    priority: 'CRITICAL',
    'entitiesData.names': ['checkout-api'],
  }
  const newrelic = payload('newrelic')
    .replace(/\{\{json ([^}]+)\}\}/g, (_, key: string) => JSON.stringify(values[key.trim()]))
    .replace('{{createdAt}}', String(ms))
  const [nr] = await parseCalskoWebhook(JSON.parse(newrelic), NOW)
  assertEquals(nr.title, 'High error rate on checkout-api')
  assertEquals(nr.fingerprint, 'ext_Error rate > 5%')
  assert(nr.raw.includes('"entities"') && nr.raw.includes('checkout-api'))

  // The token is in the headers, never in the payload.
  assert(!datadog.includes('cerr_t') && !newrelic.includes('cerr_t'))
})
