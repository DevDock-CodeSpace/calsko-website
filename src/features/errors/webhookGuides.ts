// How to point other tools at a webhook source (owner's choice, 2026-11-01: Datadog and New Relic as
// guides, not adapters). Both let you write the webhook's body yourself, so they send Calsko's own
// format (docs/ERROR_TRACKING.md → The webhook) and need no code of their own. The token goes in a
// header (Datadog's custom headers, New Relic's Bearer token), never in their payload.

export type WebhookGuide = {
  id: 'code' | 'datadog' | 'newrelic'
  label: string
  /** The steps, in order, written for someone in that tool's settings. */
  steps: string[]
  /** Things to paste, in the order the steps mention them. */
  blocks: { label: string; text: string }[]
}

export function webhookGuides(url: string, token: string): WebhookGuide[] {
  return [
    {
      id: 'code',
      label: 'Your own code',
      steps: [
        'Send a POST with JSON to the webhook URL, with the token in the x-calsko-token header.',
        'Send one request per new or returning error, or a batch ("errors": […], up to 100), not one per occurrence. "count" says how many times it happened.',
      ],
      blocks: [
        {
          label: 'Example request',
          text: `curl -X POST '${url}' \\
  -H 'x-calsko-token: ${token}' \\
  -H 'Content-Type: application/json' \\
  -d '{"errors":[{"type":"TypeError","message":"x is undefined","stack":"…","page":"https://…","count":1}]}'`,
        },
      ],
    },
    {
      id: 'datadog',
      label: 'Datadog',
      steps: [
        'In Datadog: Integrations → Webhooks → New. Name it calsko, paste the URL below.',
        'Paste the payload below, and the custom headers below (they carry the token).',
        'In each monitor that should make issues (an Error Tracking monitor, or any error monitor), add this to its message: {{#is_alert}}@webhook-calsko{{/is_alert}}. Only alerts are sent, not recoveries.',
        'Put the error details you want in the issue in the monitor’s message: it becomes the error text.',
      ],
      blocks: [
        { label: 'URL', text: url },
        {
          label: 'Payload',
          text: `{
  "title": "$ALERT_TITLE",
  "message": "$TEXT_ONLY_MSG",
  "fingerprint": "$AGGREG_KEY",
  "link": "$LINK",
  "timestamp": $DATE,
  "environment": "$TAGS[env]",
  "details": "Datadog monitor $ALERT_ID · $ALERT_TRANSITION · $ALERT_PRIORITY · tags: $TAGS"
}`,
        },
        { label: 'Custom headers', text: `{"x-calsko-token": "${token}"}` },
      ],
    },
    {
      id: 'newrelic',
      label: 'New Relic',
      steps: [
        'In New Relic: Alerts → Destinations → Webhook. Paste the URL below, choose Bearer token as authorization, and paste the token.',
        'Alerts → Workflows: add a workflow for the alert policies whose issues should become Calsko issues, and notify the webhook destination.',
        'In the notification, tick only “Activated” (not Acknowledged or Closed), and paste the payload template below.',
        'Each alert condition becomes one error in Calsko: its next alerts add to the count.',
      ],
      blocks: [
        { label: 'URL', text: url },
        { label: 'Bearer token', text: token },
        {
          label: 'Payload template',
          text: `{
  "title": {{json issueTitle}},
  "fingerprint": {{json accumulations.conditionName.[0]}},
  "link": {{json issuePageUrl}},
  "timestamp": {{createdAt}},
  "details": {
    "priority": {{json priority}},
    "condition": {{json accumulations.conditionName.[0]}},
    "entities": {{json entitiesData.names}}
  }
}`,
        },
      ],
    },
  ]
}
