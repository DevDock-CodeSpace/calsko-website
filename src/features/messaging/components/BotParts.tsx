import { ArrowUpRight, Bug, CalendarDays, CircleCheck, FileText, Siren, TriangleAlert, UserPlus, Webhook } from 'lucide-react'
import { Link } from 'react-router'
import { LogoMark } from '@/components/Logo'
import { cn } from '@/lib/utils'
import type { BotInfo } from '../bot'

/** A bot's picture: Calsko's mark for its own events, otherwise an icon for what it is. */
export function BotAvatar({ bot, className }: { bot: BotInfo; className?: string }) {
  const Icon =
    bot.level === 'critical'
      ? Siren
      : bot.kind === 'errors' || bot.icon === 'errors'
        ? Bug
        : bot.kind === 'webhook'
          ? Webhook
          : null
  return (
    <span
      className={cn(
        'flex size-8 items-center justify-center rounded-lg border bg-background',
        bot.level === 'critical' && 'border-destructive/40 text-destructive',
        className,
      )}
      aria-hidden
    >
      {Icon ? <Icon className="size-4" /> : <LogoMark className="h-4" />}
    </span>
  )
}

const LEVEL_ICON = { critical: Siren, warning: TriangleAlert, success: CircleCheck, info: null } as const
const KIND_ICON = { issue: CircleCheck, meeting: CalendarDays, plan: FileText, member: UserPlus, errors: Bug } as const

const meetingTime = new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Under a bot's text: when (a meeting, in your time zone) and where to look. */
export function BotFooter({ bot }: { bot: BotInfo }) {
  // Calsko's own events say it with the colour; alarms and summaries also in words.
  const LevelIcon = bot.kind === 'events' ? null : LEVEL_ICON[bot.level]
  const KindIcon = bot.at ? CalendarDays : bot.icon ? KIND_ICON[bot.icon] : null
  if (!bot.at && !bot.link && !bot.url && !LevelIcon) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {LevelIcon && (
        <span className={cn('flex items-center gap-1 font-medium capitalize', bot.level === 'critical' && 'text-destructive', bot.level === 'warning' && 'text-amber-700 dark:text-amber-400', bot.level === 'success' && 'text-emerald-700 dark:text-emerald-400')}>
          <LevelIcon className="size-3.5" /> {bot.level}
        </span>
      )}
      {bot.at && !Number.isNaN(Date.parse(bot.at)) && (
        <span className="flex items-center gap-1">
          {KindIcon && <KindIcon className="size-3.5" />}
          {meetingTime.format(new Date(bot.at))}
        </span>
      )}
      {bot.link && (
        <Link to={bot.link} className="flex items-center gap-0.5 font-medium text-brand hover:underline">
          Open <ArrowUpRight className="size-3" />
        </Link>
      )}
      {bot.url && (
        <a href={bot.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-0.5 font-medium text-brand hover:underline">
          View details <ArrowUpRight className="size-3" />
        </a>
      )}
    </div>
  )
}
