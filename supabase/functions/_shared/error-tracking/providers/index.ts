// Every error tracker Calsko can read. A new one (Sentry, Rollbar, CloudWatch…) is one file beside these
// and one line here, plus its name in error_sources_provider (the migration) and its settings form in
// features/errors/providers.ts. Nothing else changes.

import type { ErrorProvider } from '../types.ts'
import { posthogProvider } from './posthog.ts'
import { webhookProvider } from './webhook.ts'

export const PROVIDERS: Record<string, ErrorProvider> = {
  posthog: posthogProvider,
  webhook: webhookProvider,
}
