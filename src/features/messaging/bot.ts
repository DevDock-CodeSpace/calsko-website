import type { Json } from '@/types/database.types'

// Bot messages (docs/CHAT_FEEDS.md): posted by a chat feed, not a person. `messages.author_id` is null and
// `messages.bot` says who posted it. The database writes them; this only reads.

export type BotLevel = 'info' | 'success' | 'warning' | 'critical'
export type BotIcon = 'issue' | 'meeting' | 'plan' | 'member' | 'errors'

export type BotInfo = {
  feedId: string | null
  kind: 'events' | 'errors' | 'webhook'
  name: string
  level: BotLevel
  icon: BotIcon | null
  /** An in-app path ("/t/…"). */
  link: string | null
  /** A link outside Calsko (an alarm's console), http(s) only. */
  url: string | null
  /** When the thing it's about happens (a meeting's start), shown in the reader's time zone. */
  at: string | null
}

const LEVELS: BotLevel[] = ['info', 'success', 'warning', 'critical']
const ICONS: BotIcon[] = ['issue', 'meeting', 'plan', 'member', 'errors']
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null)

/** The message's bot, or null for a person's message. Tolerates anything in the column. */
export function botOf(bot: Json | null | undefined): BotInfo | null {
  if (!bot || typeof bot !== 'object' || Array.isArray(bot)) return null
  const kind = bot.kind === 'errors' || bot.kind === 'webhook' ? bot.kind : 'events'
  const link = text(bot.link)
  const url = text(bot.url)
  return {
    feedId: text(bot.feed_id),
    kind,
    name: text(bot.name) ?? 'Bot',
    level: LEVELS.includes(bot.level as BotLevel) ? (bot.level as BotLevel) : 'info',
    icon: ICONS.includes(bot.icon as BotIcon) ? (bot.icon as BotIcon) : null,
    link: link?.startsWith('/t/') ? link : null,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    at: text(bot.at),
  }
}

/** Two messages from the same sender, as far as bots go (people's messages are both null). */
export function sameBot(a: { bot: Json | null }, b: { bot: Json | null }) {
  const x = botOf(a.bot)
  const y = botOf(b.bot)
  if (!x || !y) return !x && !y
  return x.feedId === y.feedId && x.name === y.name
}

/** The bubble's colour says how serious it is; info looks like any message. */
export function botBubbleClass(bot: BotInfo) {
  switch (bot.level) {
    case 'critical':
      return 'bg-destructive/10 ring-1 ring-destructive/30'
    case 'warning':
      return 'bg-amber-500/10 ring-1 ring-amber-500/30'
    case 'success':
      return 'bg-emerald-500/10 ring-1 ring-emerald-500/25'
    default:
      return 'bg-muted'
  }
}
