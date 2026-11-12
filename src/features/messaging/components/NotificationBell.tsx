import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Bell, Bookmark, MessageCircle, Siren } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/features/auth/hooks'
import { useCurrentTeam } from '@/features/teams/hooks'
import { issuePath, teamPath } from '@/features/teams/nav'
import { errorMessage } from '@/lib/errors'
import { conversationKeys, markAllNotificationsRead, markNotificationRead, notificationsQuery, type Notification } from '../api'
import { useConversationTitles } from '../hooks'
import { displayName, formatWhen } from '../names'

/** The bell in the header: unread message, mention and note notifications, and where each one leads. */
export function NotificationBell() {
  const { team } = useCurrentTeam()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const notifications = useQuery(notificationsQuery(team.id, user.id)).data ?? []
  const titleOf = useConversationTitles(team.id, open)
  const refresh = () => queryClient.invalidateQueries({ queryKey: conversationKeys.notifications(team.id, user.id) })

  const clearAll = useMutation({
    mutationFn: () => markAllNotificationsRead(team.id, user.id),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  })

  const go = async (notification: Notification) => {
    const reminder = notification.reminder
    if (!notification.conversation_id && !reminder) return
    try {
      await markNotificationRead(notification.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
    setOpen(false)
    if (reminder) {
      // Its issue when it has one (and it can still be opened), else the Notes panel, here, at that note.
      navigate(
        reminder.issue && reminder.workspace_id
          ? issuePath(team.slug, reminder.workspace_id, reminder.issue.number)
          : `${location.pathname}?note=${notification.reminder_id}`,
      )
      void refresh()
      return
    }
    // A reply notification points at its thread's first message, which is the one in the timeline.
    const target = notification.message?.parent_id ?? notification.message_id
    navigate(`${teamPath(team.slug)}/messages?c=${notification.conversation_id}${target ? `&m=${target}` : ''}`)
    void refresh()
  }

  const count = notifications.length
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}>
          <Bell />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] leading-4 font-medium text-brand-foreground ring-2 ring-background">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex h-11 items-center justify-between border-b px-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {count > 0 && (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => clearAll.mutate()} disabled={clearAll.isPending}>Mark all read</Button>
          )}
        </div>
        {count === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <Bell className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">You’re all caught up</p>
            <p className="text-xs text-muted-foreground">New messages, mentions and notes you set a time for show up here.</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {notifications.map((notification) => {
              const mention = notification.kind === 'mention'
              const reminder = notification.kind === 'reminder'
              // A critical alert from a chat feed (an alarm posted into a channel).
              const alert = notification.kind === 'alert'
              const where = displayName(titleOf(notification.conversation_id))
              const Icon = reminder ? Bookmark : mention ? AtSign : alert ? Siren : MessageCircle
              return (
                <li key={notification.id}>
                  <button type="button" onClick={() => void go(notification)} className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted">
                    <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${alert ? 'bg-destructive/10 text-destructive' : mention || reminder ? 'bg-brand/10 text-brand' : 'bg-muted text-muted-foreground'}`}>
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {reminder ? (notification.reminder?.title ?? 'Note') : mention ? `Mentioned you in ${where}` : alert ? `Critical alert in ${where}` : `New message in ${where}`}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {reminder && 'Note · '}
                        {formatWhen(notification.created_at)}
                      </span>
                    </span>
                    <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
