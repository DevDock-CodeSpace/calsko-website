import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { BadPayload, type ChatPost, fromSlackMarkup, isConfirmation, isSnsHost, parsePost, type SnsConfirmation } from './parse.ts'

const none = new Headers()
const post = (body: unknown, headers = none) => parsePost(body, headers) as ChatPost

Deno.test('Calsko format: title, text, level and url', () => {
  assertEquals(post({ title: 'Disk almost full', text: 'db-1 is at 92%', level: 'warning', url: 'https://x.test/d' }), {
    title: 'Disk almost full',
    text: 'db-1 is at 92%',
    level: 'warning',
    url: 'https://x.test/d',
    source: 'calsko',
  })
  // Unknown level → info; a non-http url is dropped; `message` stands in for text.
  const p = post({ message: 'hi', level: 'PANIC', url: 'javascript:alert(1)' })
  assertEquals([p.text, p.level, p.url], ['hi', 'info', null])
})

Deno.test('Slack: plain text with links, and attachments with a colour', () => {
  const p = post({ text: 'Deploy failed\n<https://ci.test/run/9|Run 9> on <!here>' })
  assertEquals(p.title, 'Deploy failed')
  assertEquals(p.text, 'Run 9 on @here')
  assertEquals(p.url, 'https://ci.test/run/9')
  assertEquals(p.source, 'slack')

  const a = post({ attachments: [{ color: 'danger', title: 'High error rate', text: '5xx at 12%', title_link: 'https://grafana.test/a' }] })
  assertEquals([a.title, a.text, a.level, a.url], ['High error rate', '5xx at 12%', 'critical', 'https://grafana.test/a'])

  const b = post({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Backup finished' } }] })
  assertEquals([b.title, b.text], ['', 'Backup finished'])
})

Deno.test('Teams MessageCard', () => {
  const p = post({ '@type': 'MessageCard', title: 'Build broke', text: 'main is red', potentialAction: [{ '@type': 'OpenUri', targets: [{ os: 'default', uri: 'https://ci.test/1' }] }] })
  assertEquals([p.title, p.text, p.url, p.source], ['Build broke', 'main is red', 'https://ci.test/1', 'teams'])
})

Deno.test('AWS SNS: CloudWatch alarm and recovery', () => {
  const alarm = (state: string) => ({
    Type: 'Notification',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:prod-alarms',
    Subject: 'ALARM: "api-5xx" in US East (N. Virginia)',
    Message: JSON.stringify({
      AlarmName: 'api-5xx',
      AlarmDescription: '5xx above 5%',
      AWSAccountId: '123456789012',
      NewStateValue: state,
      NewStateReason: 'Threshold Crossed: 1 datapoint [7.2] was greater than the threshold (5.0).',
      Region: 'US East (N. Virginia)',
      AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:api-5xx',
    }),
  })
  const headers = new Headers({ 'x-amz-sns-message-type': 'Notification' })
  const fired = post(alarm('ALARM'), headers)
  assertEquals(fired.title, 'api-5xx: in alarm')
  assertEquals(fired.level, 'critical')
  assertEquals(fired.url, 'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:alarm/api-5xx')
  assertEquals(fired.text.split('\n')[0], 'Threshold Crossed: 1 datapoint [7.2] was greater than the threshold (5.0).')
  const ok = post(alarm('OK'), headers)
  assertEquals([ok.title, ok.level], ['api-5xx: back to OK', 'success'])
  // Without the header (some proxies drop it) the body still says it's SNS.
  assertEquals(post(alarm('ALARM')).source, 'aws')
})

Deno.test('AWS SNS: plain notification and subscription confirmation', () => {
  const plain = post({ Type: 'Notification', TopicArn: 'arn:aws:sns:eu-west-1:1:jobs', Subject: 'Nightly job', Message: 'Done in 4 min' })
  assertEquals([plain.title, plain.text, plain.level], ['Nightly job', 'Done in 4 min', 'info'])

  const c = parsePost(
    { Type: 'SubscriptionConfirmation', TopicArn: 'arn:aws:sns:us-east-1:1:prod-alarms', SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x' },
    new Headers({ 'x-amz-sns-message-type': 'SubscriptionConfirmation' }),
  ) as SnsConfirmation
  assertEquals(isConfirmation(c), true)
  assertEquals(c.post.title, 'Connected to AWS SNS topic prod-alarms')
  // Anything not on AWS's SNS hosts is refused (the function would fetch it).
  assertThrows(() => parsePost({ Type: 'SubscriptionConfirmation', TopicArn: 'arn:x', SubscribeURL: 'https://evil.test/?sns.us-east-1.amazonaws.com' }, none), BadPayload)
})

Deno.test('isSnsHost', () => {
  assertEquals(isSnsHost('https://sns.ap-south-1.amazonaws.com/x'), true)
  assertEquals(isSnsHost('https://sns.cn-north-1.amazonaws.com.cn/x'), true)
  assertEquals(isSnsHost('http://sns.us-east-1.amazonaws.com/x'), false)
  assertEquals(isSnsHost('https://sns.us-east-1.amazonaws.com.evil.test/x'), false)
  assertEquals(isSnsHost('not a url'), false)
})

Deno.test('Azure Monitor common alert schema', () => {
  const body = (sev: string, condition: string) => ({
    schemaId: 'azureMonitorCommonAlertSchema',
    data: {
      essentials: {
        alertRule: 'High CPU',
        severity: sev,
        signalType: 'Metric',
        monitorCondition: condition,
        description: 'CPU above 90% for 5 minutes',
        alertTargetIDs: ['/subscriptions/1/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm-web-1'],
      },
    },
  })
  const fired = post(body('Sev1', 'Fired'))
  assertEquals([fired.title, fired.level, fired.source], ['High CPU: fired', 'critical', 'azure'])
  assertEquals(fired.text, 'CPU above 90% for 5 minutes\nSev1 · Metric · on vm-web-1')
  assertEquals(post(body('Sev2', 'Fired')).level, 'warning')
  assertEquals(post(body('Sev3', 'Fired')).level, 'info')
  assertEquals(post(body('Sev0', 'Resolved')).level, 'success')
})

Deno.test('unreadable payloads', () => {
  assertThrows(() => parsePost([1, 2], none), BadPayload)
  assertThrows(() => parsePost({ foo: 1 }, none), BadPayload)
})

Deno.test('fromSlackMarkup keeps the first link apart', () => {
  assertEquals(fromSlackMarkup('a <https://x.test> b <https://y.test|y> &amp;'), { text: 'a https://x.test b y &', url: 'https://x.test' })
})
