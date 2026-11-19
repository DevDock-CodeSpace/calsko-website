import { saveRsvps } from './api'

// What the Google (calendar.ts) and Outlook (outlook-calendar.ts) syncs share
// beyond calendar-plan.ts.

export class CalendarAuthError extends Error {}

export type Reply = { email: string; status: 'accepted' | 'declined' | 'tentative' | 'needsAction' }

/** Replies belong to every meeting that shares the event (all of a series, or one meeting). */
export async function storeReplies(sessionIds: string[], replies: Reply[]): Promise<void> {
  for (const id of sessionIds) await saveRsvps(id, replies)
}
