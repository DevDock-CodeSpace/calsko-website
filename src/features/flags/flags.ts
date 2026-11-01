/**
 * Feature flags known to the app. Each key is a row in `public.feature_flags`, added by a migration with
 * a one-line `description` and `details` (what turning it on or off does, one point per line; the console
 * shows them as "What happens");
 * the platform admin switches it per group in the console (/admin/flags). A key here without a row is
 * always off, and a row without a key here is simply never asked about.
 *
 * A flag can have sub-features (`feature_flags.parent`, one level): the group's list only holds a sub-feature
 * while its parent is on too, so asking for the sub-feature is enough.
 *
 * Flags only show or hide things in the app. Whatever a flag guards on the server checks
 * `private.feature_enabled(team, key)` itself.
 */
export const FEATURE_FLAGS = [
  'ask_devdock',
  'ninety_sync',
  // Email and its sub-features (a sub-feature is only listed while its parent is on, too).
  'email',
  'email_invites',
  'email_reminders',
  'email_feedback',
  'email_meetings',
  'email_chat',
  // Error tracking and its sub-feature (AI-written issues).
  'error_tracking',
  'error_tracking_ai',
] as const

export type FeatureFlag = (typeof FEATURE_FLAGS)[number]
