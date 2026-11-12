import type { TeamMember } from '@/features/teams/api'
import { teamPath } from '@/features/teams/nav'

export const MESSAGE_REACTIONS = ['👍', '🎉', '✅', '🙌', '💯', '❌', '😤', '❤️']

export function conversationTitle(
  kind: string,
  name: string | null,
  people: { user_id: string; profile: { display_name: string | null } | null }[],
  currentUserId: string,
  participantIds: string[] = [],
) {
  if (kind === 'channel') return name ? `# ${name}` : '# channel'
  if (kind === 'group') return name ?? 'Group conversation'
  const otherId = participantIds.find((id) => id !== currentUserId)
  return people.find((person) => person.user_id === otherId)?.profile?.display_name ?? 'Direct message'
}

export function authorName(authorId: string | null, people: TeamMember[]) {
  return people.find((person) => person.user_id === authorId)?.profile?.display_name ?? 'Unknown member'
}

export function authorInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'U'
}

export function formatNotificationTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Ids of messages that exist only in this browser while they are being sent. */
export const pendingMessageId = (clientId: string) => `pending-${clientId}`
export const isPendingMessage = (id: string) => id.startsWith('pending-')

/** A link that opens a conversation scrolled to one message (`/t/<slug>/messages?c=…&m=…`). */
export function messagePermalink(teamSlug: string, conversationId: string, messageId: string) {
  return `${window.location.origin}${teamPath(teamSlug)}/messages?c=${conversationId}&m=${messageId}`
}

/** "# general" → "general" (the list and header draw their own # icon). */
export const displayName = (title: string) => title.replace(/^#\s*/, '')

/** Messages by the same person this close together share one avatar and name. */
export const GROUP_WINDOW_MS = 5 * 60_000

const timeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
export const formatTime = (iso: string) => timeFormat.format(new Date(iso))
export const formatFullDate = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })
export const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()

/** "Today", "Yesterday", or "Wednesday, October 7" (with the year when it isn't this year). */
export function formatDay(iso: string, now = new Date()) {
  const date = new Date(iso)
  if (date.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

/** "3:32 PM" for today, otherwise "Yesterday" / "Monday, October 5". */
export const formatWhen = (iso: string, now = new Date()) => (new Date(iso).toDateString() === now.toDateString() ? formatTime(iso) : formatDay(iso, now))
