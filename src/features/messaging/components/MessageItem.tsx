import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, MessageSquare, Pencil, Pin, SmilePlus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PersonAvatar } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { TeamMember } from '@/features/teams/api'
import { useCurrentTeam } from '@/features/teams/hooks'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  conversationKeys,
  deleteMessage,
  editMessage,
  togglePin,
  toggleReaction,
  type Message,
  type MessageAttachment,
  type Reaction,
} from '../api'
import { botBubbleClass, botOf } from '../bot'
import { authorName, formatFullDate, formatTime, isPendingMessage, MESSAGE_REACTIONS, messagePermalink } from '../names'
import { AttachmentItem } from './AttachmentItem'
import { BotAvatar, BotFooter } from './BotParts'
import { MessageBody } from './MessageBody'
import { MessageEditor } from './MessageEditor'
import { ThreadReplyBox } from './ThreadReplyBox'

type Props = {
  message: Message
  conversationId: string
  teamId: string
  people: TeamMember[]
  currentUserId: string
  pinned: boolean
  reactions: Reaction[]
  attachments: MessageAttachment[]
  replies: Message[]
  participants: TeamMember[]
  teamSlug: string
  /** Replies in this thread you haven't seen yet. */
  threadUnread: number
  /** Same author as the message above, a moment later: no avatar or name, just the text. */
  compact: boolean
  /** Signed links for the conversation's images, from one batch. */
  imageUrls: Record<string, string> | undefined
  imagesLoading: boolean
}

const toolbarButton = 'size-7 text-muted-foreground hover:text-foreground'

export function MessageItem({ message, conversationId, teamId, teamSlug, people, participants, currentUserId, pinned, reactions, attachments, replies, threadUnread, compact, imageUrls, imagesLoading }: Props) {
  const queryClient = useQueryClient()
  const { can } = useCurrentTeam()
  const [threadOpen, setThreadOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const refreshMessages = () => queryClient.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) })
  const edit = useMutation({
    mutationFn: ({ content, body }: { content: string; body: Message['body'] }) => editMessage(message.id, content, body),
    onSuccess: () => {
      setEditing(false)
      void refreshMessages()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const remove = useMutation({ mutationFn: () => deleteMessage(message.id), onSuccess: () => void refreshMessages(), onError: (error) => toast.error(errorMessage(error)) })
  const react = useMutation({
    mutationFn: ({ emoji, active }: { emoji: string; active: boolean }) => toggleReaction({ messageId: message.id, conversationId, teamId, userId: currentUserId, emoji, active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: conversationKeys.reactions(conversationId) }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const pin = useMutation({
    mutationFn: () => togglePin({ messageId: message.id, conversationId, teamId, active: pinned }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['messaging', 'pins', conversationId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const copyLink = () => {
    navigator.clipboard.writeText(messagePermalink(teamSlug, conversationId, message.id)).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy the link.'),
    )
  }
  // A bot's message (a chat feed: Calsko events, error summaries, outside alarms) has no author.
  const bot = botOf(message.bot)
  const mine = !bot && message.author_id === currentUserId
  const sending = isPendingMessage(message.id)
  const deleted = message.deleted_at !== null
  const person = people.find((item) => item.user_id === message.author_id)
  const name = bot ? bot.name : mine ? 'You' : authorName(message.author_id, people)
  // Authors delete their own messages; group owners and admins also a bot's (a noisy alarm).
  const canDelete = mine || (bot !== null && can.isAdmin)
  const time = formatTime(message.created_at)
  const mentionNames = people.flatMap((item) => (item.profile?.display_name ? [item.profile.display_name] : []))
  // Yours sit on the right, everyone else's on the left. Avatar and name only for other people,
  // and only with more than two people here: in a one-to-one chat you know who wrote it.
  const showAuthor = bot !== null || (!mine && participants.length > 2)
  // Files sent without any text: show just the files, not an empty bubble.
  const filesOnly = !deleted && attachments.length > 0 && message.body !== null && !JSON.stringify(message.body).includes('"type":"text"')

  // One pill per emoji that has reactions: how many, whether you're in it, and who (on hover).
  const pills = MESSAGE_REACTIONS.flatMap((emoji) => {
    const forEmoji = reactions.filter((reaction) => reaction.emoji === emoji)
    if (forEmoji.length === 0) return []
    const active = forEmoji.some((reaction) => reaction.user_id === currentUserId)
    const who = forEmoji.map((reaction) => (reaction.user_id === currentUserId ? 'You' : authorName(reaction.user_id, people))).join(', ')
    return [{ emoji, count: forEmoji.length, active, who }]
  })
  const toggle = (emoji: string) => react.mutate({ emoji, active: reactions.some((reaction) => reaction.user_id === currentUserId && reaction.emoji === emoji) })

  const actions =
    !deleted && !sending && !editing ? (
      <div
        className={cn(
          // Right beside the bubble, as in WhatsApp: left of yours, right of everyone else's.
          // Touch screens can't hover, so there it is always shown, under the bubble.
          'z-10 w-fit whitespace-nowrap',
          '[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:-translate-y-1/2',
          mine ? '[@media(hover:hover)]:right-full [@media(hover:hover)]:mr-1.5 [@media(hover:none)]:ml-auto' : '[@media(hover:hover)]:left-full [@media(hover:hover)]:ml-1.5',
          '[@media(hover:none)]:mt-1',
          'flex items-center rounded-md border bg-background p-0.5 shadow-sm',
          // Shown on hover or keyboard focus.
          'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100',
          pickerOpen && '[@media(hover:hover)]:opacity-100',
        )}
      >
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-xs" className={toolbarButton} aria-label="Add reaction" title="Add reaction"><SmilePlus /></Button>
          </PopoverTrigger>
          <PopoverContent align={mine ? 'start' : 'end'} className="w-auto flex-row gap-0.5 p-1">
            {MESSAGE_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Toggle ${emoji} reaction`}
                className="flex size-8 items-center justify-center rounded text-base hover:bg-muted"
                onClick={() => {
                  toggle(emoji)
                  setPickerOpen(false)
                }}
              >
                {emoji}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <ToolbarButton label="Reply in thread" onClick={() => setThreadOpen((open) => !open)}><MessageSquare /></ToolbarButton>
        <ToolbarButton label="Copy link to message" onClick={copyLink}><Link2 /></ToolbarButton>
        <ToolbarButton label={pinned ? 'Unpin message' : 'Pin message'} onClick={() => pin.mutate()} active={pinned}><Pin className={pinned ? 'fill-current' : undefined} /></ToolbarButton>
        {mine && <ToolbarButton label="Edit message" onClick={() => setEditing(true)}><Pencil /></ToolbarButton>}
        {canDelete && <ToolbarButton label="Delete message" onClick={() => remove.mutate()} disabled={remove.isPending}><Trash2 /></ToolbarButton>}
      </div>
    ) : null

  return (
    <article
      id={`message-${message.id}`}
      className={cn(
        'group relative flex gap-2 px-4 transition-colors',
        mine && 'justify-end',
        compact ? 'py-0.5' : 'pt-2 pb-1',
        sending && 'opacity-60',
      )}
    >
      {showAuthor && (
        <div className="w-8 shrink-0 pt-0.5">
          {compact ? (
            <time className="block pt-1 text-right font-mono text-[10px] text-transparent group-hover:text-muted-foreground" dateTime={message.created_at} title={formatFullDate(message.created_at)}>{time}</time>
          ) : bot ? (
            <BotAvatar bot={bot} />
          ) : (
            <PersonAvatar profile={person?.profile ?? null} userId={message.author_id ?? undefined} className="size-8" fallbackClassName="text-xs" />
          )}
        </div>
      )}
      <div className={cn('min-w-0', editing || threadOpen ? 'flex-1' : 'max-w-[75%] [@media(hover:hover)]:max-w-[min(75%,calc(100%-11.5rem))]', mine && 'flex flex-col items-end')} title={compact && !showAuthor ? formatFullDate(message.created_at) : undefined}>
        {!compact && (
          <div className={cn('flex flex-wrap items-baseline gap-x-2 px-1 pb-0.5', mine && 'justify-end')}>
            {showAuthor && <span className="text-sm font-semibold">{name}</span>}
            {bot && <span className="rounded bg-muted px-1 py-px text-[10px] font-medium tracking-wide text-muted-foreground uppercase">App</span>}
            <time className="font-mono text-[11px] text-muted-foreground" dateTime={message.created_at} title={formatFullDate(message.created_at)}>{time}</time>
            {message.edited_at && !deleted && <span className="text-xs text-muted-foreground">(edited)</span>}
            {sending && <span className="text-xs text-muted-foreground">Sending…</span>}
            {pinned && !deleted && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Pin className="size-3 fill-current" />Pinned</span>}
          </div>
        )}
        {compact && (message.edited_at || sending || pinned) && !deleted && (
          <div className={cn('flex items-center gap-2 px-1 pb-0.5 text-xs text-muted-foreground', mine && 'justify-end')}>
            {message.edited_at && <span>(edited)</span>}
            {sending && <span>Sending…</span>}
            {pinned && <span className="flex items-center gap-1"><Pin className="size-3 fill-current" />Pinned</span>}
          </div>
        )}
        {filesOnly && !editing ? null : editing ? (
          <div className="self-stretch"><MessageEditor body={message.body} saving={edit.isPending} onSave={(content, body) => edit.mutate({ content, body })} onCancel={() => setEditing(false)} /></div>
        ) : (
          // A chat bubble, as in Teams or WhatsApp: yours tinted, everyone else's grey. Its actions sit beside it.
          <div className="relative w-fit max-w-full">
            <div className={cn('rounded-2xl px-3 py-1.5', mine ? 'bg-brand/15 dark:bg-brand/30' : bot ? botBubbleClass(bot) : 'bg-muted', deleted && 'bg-transparent ring-1 ring-border')}>
              {deleted ? (
                <p className="text-sm text-muted-foreground italic">This message was deleted.</p>
              ) : (
                <>
                  <MessageBody body={message.body} fallback={message.content} mentionNames={mentionNames} />
                  {bot && <BotFooter bot={bot} />}
                </>
              )}
            </div>
            {actions}
          </div>
        )}
        {!deleted && attachments.length > 0 && (
          <div className={cn('relative flex w-fit max-w-full flex-wrap gap-1.5', !filesOnly && 'mt-1.5', mine && 'justify-end')}>
            {attachments.map((attachment) => <AttachmentItem key={attachment.id} attachment={attachment} previewUrl={imageUrls?.[attachment.storage_path]} previewLoading={imagesLoading && !imageUrls?.[attachment.storage_path]} />)}
            {filesOnly && actions}
          </div>
        )}
        {!deleted && !sending && pills.length > 0 && (
          <div className={cn('mt-1.5 flex flex-wrap items-center gap-1', mine && 'justify-end')}>
            {pills.map((pill) => (
              <button
                key={pill.emoji}
                type="button"
                onClick={() => toggle(pill.emoji)}
                aria-label={`Toggle ${pill.emoji} reaction`}
                aria-pressed={pill.active}
                title={pill.who}
                className={cn(
                  'flex h-6 items-center rounded-full border px-2 text-xs transition-colors',
                  pill.active ? 'border-brand/40 bg-brand/10 text-brand' : 'bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {pill.emoji} {pill.count}
              </button>
            ))}
          </div>
        )}
        {!deleted && !sending && replies.length > 0 && (
          <button type="button" onClick={() => setThreadOpen((open) => !open)} className="mt-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium text-brand hover:bg-brand/10" aria-expanded={threadOpen}>
            <MessageSquare className="size-3.5" />
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            {threadUnread > 0 && !threadOpen && <span className="rounded-full bg-brand px-1.5 font-mono text-[10px] leading-4 text-brand-foreground">{threadUnread} new</span>}
          </button>
        )}
        {threadOpen && !deleted && <div className="self-stretch"><ThreadReplyBox conversationId={conversationId} teamId={teamId} teamSlug={teamSlug} parentId={message.id} replies={replies} people={people} participants={participants} currentUserId={currentUserId} /></div>}
      </div>

    </article>
  )
}

function ToolbarButton({ label, onClick, children, active, disabled }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="icon-xs" className={cn(toolbarButton, active && 'text-brand')} onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      {children}
    </Button>
  )
}
