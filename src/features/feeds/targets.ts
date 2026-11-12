import type { Conversation } from '@/features/messaging/api'

/** "# activity (new)": made by the server when a feed is switched on or a webhook added without a target. */
export const NEW_ACTIVITY = 'new-activity'
/** A per-event target that follows the feed's own. */
export const SAME_AS_FEED = 'same'
/** "New private conversation…": opens the dialog that makes one. */
export const NEW_PRIVATE = 'new-private'

/** Where a feed can post: the group's channels (everyone) and the private conversations you're in (chosen people). */
export const feedTargets = (conversations: Conversation[]) => conversations.filter((c) => c.kind === 'channel' || c.kind === 'group')
