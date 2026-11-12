import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, Bell, BellOff, Hash, MessageCircle, Users } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AvatarStack } from '@/components/PersonRow'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/hooks'
import type { TeamMember } from '@/features/teams/api'
import { useOthersTyping } from '@/hooks/use-others-typing'
import {
  attachmentImageUrlsQuery,
  isImageAttachment,
  NOTIFICATION_LIMIT,
  PAGE_SIZE,
  conversationAttachmentsQuery,
  conversationKeys,
  conversationMembersQuery,
  conversationReactionsQuery,
  conversationRepliesQuery,
  markConversationNotificationsRead,
  markConversationRead,
  messagesQuery,
  notificationsQuery,
  pinsQuery,
  threadUnreadQuery,
  unreadCountsQuery,
  type Message,
  type UnreadCount,
} from '../api'
import { sameBot } from '../bot'
import { useSendMessage, useSetNotificationMode } from '../hooks'
import { displayName, formatDay, GROUP_WINDOW_MS, isPendingMessage, sameDay } from '../names'
import { AddGroupMemberDialog } from './AddGroupMemberDialog'
import { MessageComposer } from './MessageComposer'
import { MessageItem } from './MessageItem'
import { logError } from '@/lib/error-tracking'

type Props = {
  conversationId: string
  kind: string
  /** The channel's description, if it has one. */
  description?: string | null
  teamId: string
  teamSlug: string
  isGroup: boolean
  title: string
  muted: boolean
  people: TeamMember[]
  /** A message to scroll to (from a link or a search result); `onTargetHandled` clears it. */
  targetMessageId?: string
  onTargetHandled: () => void
}

const NONE: never[] = []
const NO_URLS: Record<string, string> = {}
/** Within this many pixels of the bottom counts as "reading the latest". */
const BOTTOM_SLACK = 80
/** How far back a link may reach for a message that isn't in the loaded window. */
const MAX_LINK_WINDOW = 1000
const HIGHLIGHT_MS = 2500
const HIGHLIGHT_CLASSES = ['bg-brand/10', 'ring-1', 'ring-brand/40']

function groupBy<T>(rows: T[], key: (row: T) => string | null) {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    if (id) map.set(id, [...(map.get(id) ?? []), row])
  }
  return map
}

export function ConversationView({ conversationId, kind, description, teamId, teamSlug, isGroup, title, muted, people, targetMessageId, onTargetHandled }: Props) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const messagesResult = useQuery({ ...messagesQuery(conversationId, limit), placeholderData: keepPreviousData })
  const messages = messagesResult.data ?? NONE
  const members = useQuery(conversationMembersQuery(conversationId)).data ?? NONE
  const pins = useQuery(pinsQuery(conversationId)).data ?? NONE
  // One request each for the whole conversation (not per message), grouped here.
  const reactions = useQuery(conversationReactionsQuery(conversationId)).data ?? NONE
  const attachments = useQuery(conversationAttachmentsQuery(conversationId)).data ?? NONE
  const replies = useQuery(conversationRepliesQuery(conversationId)).data ?? NONE
  const threadUnread = useQuery(threadUnreadQuery(conversationId)).data
  // Every image's link in one request; while a new one is signed, the others keep theirs.
  const imagePaths = useMemo(() => attachments.filter((row) => isImageAttachment(row.mime_type)).map((row) => row.storage_path), [attachments])
  const images = useQuery({ ...attachmentImageUrlsQuery(conversationId, imagePaths), enabled: imagePaths.length > 0, placeholderData: keepPreviousData })
  const imageUrls = images.isError ? NO_URLS : images.data
  const imagesLoading = !images.isError && (images.isPending || images.isPlaceholderData)
  const byMessage = useMemo(
    () => ({
      reactions: groupBy(reactions, (row) => row.message_id),
      attachments: groupBy(attachments, (row) => row.message_id),
      replies: groupBy(replies, (row) => row.parent_id),
    }),
    [reactions, attachments, replies],
  )
  // A channel is for the whole group; DMs and groups are for their members.
  const participants = useMemo(() => (kind === 'channel' ? people : people.filter((person) => members.some((member) => member.user_id === person.user_id))), [kind, people, members])
  const pinned = useMemo(() => new Set(pins.map((pin) => pin.message_id)), [pins])

  const send = useSendMessage(conversationId, teamId, limit)
  const retryId = useRef<string | null>(null)
  const setMode = useSetNotificationMode(conversationId)
  const { others, markTyping } = useOthersTyping(`messages:${conversationId}`, true)

  // --- scrolling: stay at the bottom while reading the latest, otherwise offer a jump ---
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const anchor = useRef<number | null>(null)
  const [newBelow, setNewBelow] = useState(false)
  const last = messages.at(-1)
  const lastId = last?.id
  const lastMine = last?.author_id === user.id

  // Both are already loaded for the sidebar badge and the bell, so these add no request.
  // They let reading skip the writes that would change nothing: every write here is
  // echoed to each open tab as a refetch.
  const counts = useQuery(unreadCountsQuery(teamId)).data
  const unreadHere = counts === undefined ? undefined : (counts.find((row) => row.conversation_id === conversationId)?.unread_count ?? 0)
  const notices = useQuery(notificationsQuery(teamId, user.id)).data

  const markedId = useRef<string | undefined>(undefined)
  const opened = useRef(false)
  const clearedNotices = useRef('')
  const markRead = useCallback(() => {
    const latest = [...messages].reverse().find((message) => !isPendingMessage(message.id))
    if (!latest || document.hidden || !atBottom.current) return
    // Nothing unread (your own message, or already read): the read position needn't move.
    // The count can lag a new message by a moment; this runs again when it arrives.
    if (markedId.current !== latest.id && unreadHere !== 0) {
      markedId.current = latest.id
      // The badges drop at once, not when the receipt's echo arrives: a tab that is just
      // reconnecting (back after being hidden) can miss that echo and keep the old count.
      const unreadKey = conversationKeys.unread(teamId)
      queryClient.setQueryData(unreadKey, (rows: UnreadCount[] | undefined) =>
        rows?.map((row) => (row.conversation_id === conversationId ? { ...row, unread_count: 0, mention_count: 0 } : row)),
      )
      markConversationRead(conversationId, latest.id)
        .then(() => {
          // A count fetched before the receipt was saved would bring the old number back.
          const row = queryClient.getQueryData<UnreadCount[]>(unreadKey)?.find((r) => r.conversation_id === conversationId)
          if ((row?.unread_count ?? 0) > 0 || queryClient.isFetching({ queryKey: unreadKey }) > 0) {
            void queryClient.invalidateQueries({ queryKey: unreadKey })
          }
        })
        .catch((error: unknown) => {
          logError('[messaging] Could not mark read', error)
          markedId.current = undefined
          void queryClient.invalidateQueries({ queryKey: unreadKey })
        })
    }
    // Reading the conversation also clears its bell notifications: all of them when it
    // opens, afterwards those for new messages (a reply's stays until its thread is read).
    if (notices === undefined) return
    const first = !opened.current
    opened.current = true
    const here = notices.filter((notice) => notice.conversation_id === conversationId && (first || !notice.message?.parent_id))
    // At the limit the bell may not have loaded this conversation's, so clear once per new message.
    const batch = here.length > 0 ? here.map((notice) => notice.id).join() : notices.length >= NOTIFICATION_LIMIT ? `latest:${latest.id}` : ''
    if (!batch || batch === clearedNotices.current) return
    clearedNotices.current = batch
    markConversationNotificationsRead(conversationId, user.id).catch((error: unknown) => logError('[messaging] Could not clear notifications', error))
  }, [messages, conversationId, teamId, user.id, unreadHere, notices, queryClient])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (atBottom.current || lastMine) el.scrollTop = el.scrollHeight
    else setNewBelow(true)
  }, [lastId, lastMine])

  // Things that grow after a message arrives (a picture loading, reactions) keep the latest in view.
  const stickToBottom = useCallback((content: HTMLDivElement | null) => {
    if (!content) return
    const observer = new ResizeObserver(() => {
      const el = scroller.current
      if (el && atBottom.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  // After earlier messages load, keep the reader where they were.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && anchor.current !== null) {
      el.scrollTop += el.scrollHeight - anchor.current
      anchor.current = null
    }
  }, [messages.length])

  useEffect(() => {
    markRead()
  }, [markRead])

  useEffect(() => {
    const onVisible = () => markRead()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [markRead])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK
    if (atBottom.current) {
      setNewBelow(false)
      markRead()
    }
  }
  const jumpToLatest = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }
  const loadEarlier = () => {
    anchor.current = scroller.current?.scrollHeight ?? null
    // Reading back now: growth above must not pull the view down.
    atBottom.current = false
    setLimit((current) => current + PAGE_SIZE)
  }

  const hasMore = messages.length >= limit

  // --- opening a link to one message: load back until it's there, scroll to it, outline it briefly ---
  const ready = !messagesResult.isPending && !messagesResult.isPlaceholderData
  const targetMissing = Boolean(targetMessageId) && ready && !messages.some((message) => message.id === targetMessageId)
  // Not loaded yet: widen the window (adjusting state while rendering, guarded so it stops).
  if (targetMissing && hasMore && limit < MAX_LINK_WINDOW) setLimit(limit + PAGE_SIZE)
  const giveUp = targetMissing && (!hasMore || limit >= MAX_LINK_WINDOW)
  const highlightTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!targetMessageId || !ready) return
    const el = document.getElementById(`message-${targetMessageId}`)
    if (el) {
      atBottom.current = false
      el.scrollIntoView({ block: 'center' })
      // Where that leaves the view decides whether it counts as read. A message already in
      // view (usually the latest, from a notification) doesn't scroll at all, so no scroll
      // event would ever say the reader is at the bottom.
      const box = scroller.current
      atBottom.current = box !== null && box.scrollHeight - box.scrollTop - box.clientHeight < BOTTOM_SLACK
      if (atBottom.current) markRead()
      // Plain DOM classes: a short outline that needs no re-render.
      el.classList.add(...HIGHLIGHT_CLASSES)
      window.clearTimeout(highlightTimer.current)
      highlightTimer.current = window.setTimeout(() => el.classList.remove(...HIGHLIGHT_CLASSES), HIGHLIGHT_MS)
      onTargetHandled()
    } else if (giveUp) {
      toast.error('That message is no longer available.')
      onTargetHandled()
    }
  }, [targetMessageId, messages, ready, giveUp, onTargetHandled, markRead])
  useEffect(() => () => window.clearTimeout(highlightTimer.current), [])

  const subtitle = description || (kind === 'channel' ? `${people.length} members` : kind === 'dm' ? 'Direct message' : `${members.length} participant${members.length === 1 ? '' : 's'}`)
  const typingLine = others.length === 0 ? null : `${others.slice(0, 3).join(', ')} ${others.length === 1 ? 'is' : 'are'} typing…`

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {kind === 'channel' ? <Hash className="size-4" /> : kind === 'group' ? <Users className="size-4" /> : <MessageCircle className="size-4" />}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{displayName(title)}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {participants.length > 0 && <AvatarStack people={participants.map((person) => person.profile ?? { display_name: null, avatar_url: null })} max={4} />}
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={setMode.isPending} onClick={() => setMode.mutate(muted ? 'mentions' : 'muted')} aria-pressed={muted} title={muted ? 'Turn notifications back on' : 'Mute this conversation'}>
            {muted ? <BellOff /> : <Bell />}
            <span className="max-sm:sr-only">{muted ? 'Muted' : 'Mute'}</span>
          </Button>
          {isGroup && <AddGroupMemberDialog conversationId={conversationId} members={members} people={people} onAdded={() => { void queryClient.invalidateQueries({ queryKey: conversationKeys.members(conversationId) }); void queryClient.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) }) }} />}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto">
          {messagesResult.isPending ? (
            <div className="space-y-5 px-4 py-4" aria-busy="true">
              <span className="sr-only">Loading messages…</span>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : messagesResult.isError && messages.length === 0 ? (
            <div role="alert" className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">Couldn’t load messages. <Button variant="link" size="xs" onClick={() => void messagesResult.refetch()}>Try again</Button></div>
          ) : messages.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {kind === 'channel' ? <Hash className="size-5" /> : <MessageCircle className="size-5" />}
              </div>
              <p className="text-sm font-medium">{kind === 'channel' ? `This is the start of ${title}` : `This is the start of your conversation with ${title}`}</p>
              <p className="text-sm text-muted-foreground">Start the conversation.</p>
            </div>
          ) : (
            <div ref={stickToBottom} className="flex min-h-full flex-col justify-end py-3">
              {hasMore && (
                <div className="flex justify-center pb-2">
                  <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={loadEarlier} disabled={messagesResult.isPlaceholderData}>{messagesResult.isPlaceholderData ? 'Loading…' : 'Load earlier messages'}</Button>
                </div>
              )}
              {messages.map((message: Message, index) => {
                const previous = messages[index - 1]
                const newDay = !previous || !sameDay(previous.created_at, message.created_at)
                const compact = !newDay && previous.author_id === message.author_id && sameBot(previous, message) && !previous.deleted_at && !message.deleted_at && Date.parse(message.created_at) - Date.parse(previous.created_at) < GROUP_WINDOW_MS
                return (
                  <div key={message.id}>
                    {newDay && (
                      <div className="flex items-center gap-3 px-4 py-3 text-xs font-medium text-muted-foreground" role="separator">
                        <span className="h-px flex-1 bg-border" />
                        {formatDay(message.created_at)}
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <MessageItem
                      message={message}
                      conversationId={conversationId}
                      teamId={message.team_id}
                      people={people}
                      currentUserId={user.id}
                      pinned={pinned.has(message.id)}
                      reactions={byMessage.reactions.get(message.id) ?? NONE}
                      attachments={byMessage.attachments.get(message.id) ?? NONE}
                      replies={byMessage.replies.get(message.id) ?? NONE}
                      teamSlug={teamSlug}
                      participants={participants}
                      threadUnread={threadUnread?.get(message.id) ?? 0}
                      compact={compact}
                      imageUrls={imageUrls}
                      imagesLoading={imagesLoading}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {newBelow && (
          <Button size="xs" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 shadow-md" onClick={jumpToLatest}><ArrowDown /> New messages</Button>
        )}
      </div>
      <div className="h-5 shrink-0 px-5 text-xs text-muted-foreground" aria-live="polite">{typingLine}</div>
      <MessageComposer
        draftId={conversationId}
        teamId={teamId}
        teamSlug={teamSlug}
        placeholder={kind === 'channel' ? `Message #${displayName(title)}` : `Message ${displayName(title)}`}
        currentUserId={user.id}
        participants={participants}
        onTyping={markTyping}
        onSend={(input, restore) => {
          const clientId = retryId.current ?? crypto.randomUUID()
          retryId.current = null
          send.mutate(
            { ...input, clientId },
            {
              onError: () => {
                // The same id on retry keeps a send that did reach the server from posting twice.
                retryId.current = clientId
                restore()
              },
            },
          )
        }}
      />
    </>
  )
}
