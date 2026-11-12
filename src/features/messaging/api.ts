import { queryOptions } from '@tanstack/react-query'
import { toDataError } from '@/lib/errors'
import { SETTLED_STALE_MS } from '@/lib/query-client'
import { supabase } from '@/lib/supabase'
import type { Database, Json, Tables } from '@/types/database.types'

export type ConversationKind = 'channel' | 'dm' | 'group'
export type Conversation = Pick<
  Tables<'conversations'>,
  'id' | 'team_id' | 'kind' | 'name' | 'description' | 'is_archived' | 'created_at' | 'updated_at'
>
export type ConversationMember = Tables<'conversation_members'>
export type Message = Tables<'messages'>
export type NotificationMode = 'all' | 'mentions' | 'muted'
export type UnreadCount = Database['public']['Functions']['conversation_unread_counts']['Returns'][number]
export type Notification = Tables<'notifications'> & {
  message?: { parent_id: string | null } | null
  /** A reminder notification's reminder: what to say, and where a click leads (its issue, else Reminders). */
  reminder?: { title: string; notes: string | null; workspace_id: string | null; issue: { number: number } | null } | null
}
export type Reaction = Tables<'message_reactions'>
export type Pin = Tables<'message_pins'>
export type MessageAttachment = Tables<'message_attachments'>
export type MessageMention = Tables<'message_mentions'>
export type MessageSearchResult = Database['public']['Functions']['search_messages']['Returns'][number]

export const MESSAGE_ATTACHMENT_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const
export const MESSAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

export const PAGE_SIZE = 50
/** The bell loads this many unread notifications; at the limit there may be more it hasn't loaded. */
export const NOTIFICATION_LIMIT = 20

// Groups whose #general channel this browser has already made sure of. The RPC
// writes even when the channel exists, and every write is announced to every open
// tab, so it runs once per browser and group rather than on every page load.
const ensuredTeams = new Set<string>()
const ENSURED_KEY = 'devdock-general-channel'

function alreadyEnsured(teamId: string) {
  if (ensuredTeams.has(teamId)) return true
  try {
    return (JSON.parse(localStorage.getItem(ENSURED_KEY) ?? '[]') as unknown[]).includes(teamId)
  } catch {
    return false
  }
}

function rememberEnsured(teamId: string) {
  ensuredTeams.add(teamId)
  try {
    const saved = JSON.parse(localStorage.getItem(ENSURED_KEY) ?? '[]') as unknown[]
    localStorage.setItem(ENSURED_KEY, JSON.stringify([...new Set([...saved, teamId])].slice(-50)))
  } catch {
    // Private mode or a full store: it is checked again on the next load, as before.
  }
}

export const conversationKeys = {
  all: ['messaging'] as const,
  conversations: (teamId: string) => ['messaging', 'conversations', teamId] as const,
  members: (conversationId: string) => ['messaging', 'members', conversationId] as const,
  messages: (conversationId: string, limit?: number) =>
    limit === undefined
      ? (['messaging', 'messages', conversationId] as const)
      : (['messaging', 'messages', conversationId, limit] as const),
  threadUnread: (conversationId: string) => ['messaging', 'thread-unread', conversationId] as const,
  unread: (teamId: string) => ['messaging', 'unread', teamId] as const,
  preferences: ['messaging', 'preferences'] as const,
  reactions: (conversationId: string) => ['messaging', 'reactions', conversationId] as const,
  attachments: (conversationId: string) => ['messaging', 'attachments', conversationId] as const,
  replies: (conversationId: string) => ['messaging', 'thread', conversationId] as const,
  notifications: (teamId: string, userId: string) => ['messaging', 'notifications', teamId, userId] as const,
}

export const teamConversationsQuery = (teamId: string) =>
  queryOptions({
    queryKey: conversationKeys.conversations(teamId),
    queryFn: async (): Promise<Conversation[]> => {
      if (!alreadyEnsured(teamId)) {
        const { error: ensureError } = await supabase.rpc('ensure_general_channel', { p_team_id: teamId })
        if (ensureError) throw toDataError('prepare messages', ensureError)
        rememberEnsured(teamId)
      }
      const { data, error } = await supabase
        .from('conversations')
        .select('id, team_id, kind, name, description, is_archived, created_at, updated_at')
        .eq('team_id', teamId)
        // Archived conversations are kept but not listed (the unread counts leave them out too).
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
      if (error) throw toDataError('load conversations', error)
      return data
    },
  })

export const conversationMembersQuery = (conversationId: string) =>
  queryOptions({
    queryKey: conversationKeys.members(conversationId),
    queryFn: async (): Promise<ConversationMember[]> => {
      const { data, error } = await supabase
        .from('conversation_members')
        .select('conversation_id, team_id, user_id, role, joined_at, left_at, history_from')
        .eq('conversation_id', conversationId)
        .is('left_at', null)
      if (error) throw toDataError('load conversation members', error)
      return data
    },
  })

/** Every thread reply in the conversation, in one request; the UI groups them by `parent_id`. */
export const conversationRepliesQuery = (conversationId: string) =>
  queryOptions({
    queryKey: conversationKeys.replies(conversationId),
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, team_id, author_id, bot, parent_id, client_id, body, content, edited_at, deleted_at, created_at')
        .eq('conversation_id', conversationId)
        .not('parent_id', 'is', null)
        .order('created_at')
        .order('id')
      if (error) throw toDataError('load thread replies', error)
      return data
    },
  })

/** Every reaction in the conversation, in one request; the UI groups them by `message_id`. */
export const conversationReactionsQuery = (conversationId: string) =>
  queryOptions({
    queryKey: conversationKeys.reactions(conversationId),
    queryFn: async (): Promise<Reaction[]> => {
      const { data, error } = await supabase.from('message_reactions').select('message_id, conversation_id, team_id, user_id, emoji, created_at').eq('conversation_id', conversationId)
      if (error) throw toDataError('load reactions', error)
      return data
    },
  })

export const pinsQuery = (conversationId: string) =>
  queryOptions({
    queryKey: ['messaging', 'pins', conversationId] as const,
    queryFn: async (): Promise<Pin[]> => {
      const { data, error } = await supabase.from('message_pins').select('message_id, conversation_id, team_id, pinned_by, pinned_at').eq('conversation_id', conversationId).order('pinned_at', { ascending: false })
      if (error) throw toDataError('load pinned messages', error)
      return data
    },
  })

export const teamConversationMembersQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['messaging', 'members', 'team', teamId] as const,
    queryFn: async (): Promise<ConversationMember[]> => {
      const { data, error } = await supabase
        .from('conversation_members')
        .select('conversation_id, team_id, user_id, role, joined_at, left_at, history_from')
        .eq('team_id', teamId)
        .is('left_at', null)
      if (error) throw toDataError('load conversation members', error)
      return data
    },
  })

/** The newest `limit` top-level messages, oldest first. Loading earlier history raises the limit, so a refetch never leaves a gap. */
export const messagesQuery = (conversationId: string, limit = PAGE_SIZE) =>
  queryOptions({
    queryKey: conversationKeys.messages(conversationId, limit),
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, team_id, author_id, bot, parent_id, client_id, body, content, edited_at, deleted_at, created_at')
        .eq('conversation_id', conversationId)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)
      if (error) throw toDataError('load messages', error)
      return data.reverse()
    },
  })

/** Threads you take part in that have replies you haven't seen: `parent_id → count`. */
export const threadUnreadQuery = (conversationId: string) =>
  queryOptions({
    queryKey: conversationKeys.threadUnread(conversationId),
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.rpc('thread_unread_counts', { p_conversation_id: conversationId })
      if (error) throw toDataError('load unread replies', error)
      return new Map(data.map((row) => [row.parent_id, row.unread_count]))
    },
  })

export async function markThreadRead(parentId: string) {
  const { error } = await supabase.rpc('mark_thread_read', { p_parent_id: parentId })
  if (error) throw toDataError('mark the thread read', error)
}

export const unreadCountsQuery = (teamId: string) =>
  queryOptions({
    queryKey: conversationKeys.unread(teamId),
    queryFn: async (): Promise<UnreadCount[]> => {
      const { data, error } = await supabase.rpc('conversation_unread_counts', { p_team_id: teamId })
      if (error) throw toDataError('load unread counts', error)
      return data
    },
  })

/** The caller's own notification settings (RLS limits the rows to them). */
export const preferencesQuery = () =>
  queryOptions({
    queryKey: conversationKeys.preferences,
    staleTime: SETTLED_STALE_MS,
    queryFn: async (): Promise<{ conversation_id: string; notification_mode: NotificationMode }[]> => {
      const { data, error } = await supabase.from('conversation_preferences').select('conversation_id, notification_mode')
      if (error) throw toDataError('load notification settings', error)
      return data.map((row) => ({ conversation_id: row.conversation_id, notification_mode: row.notification_mode as NotificationMode }))
    },
  })

export async function setNotificationMode(conversationId: string, mode: NotificationMode) {
  const { error } = await supabase
    .from('conversation_preferences')
    .upsert({ conversation_id: conversationId, notification_mode: mode, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id,user_id' })
  if (error) throw toDataError('change the notification setting', error)
}

export const notificationsQuery = (teamId: string, userId: string) =>
  queryOptions({
    queryKey: conversationKeys.notifications(teamId, userId),
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select(
          'id, team_id, recipient_id, conversation_id, message_id, reminder_id, kind, dedupe_key, read_at, created_at, message:messages(parent_id), reminder:reminders(title, notes, workspace_id, issue:issues(number))',
        )
        .eq('team_id', teamId)
        .eq('recipient_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(NOTIFICATION_LIMIT)
      if (error) throw toDataError('load notifications', error)
      return data
    },
  })

export const searchMessagesQuery = (teamId: string, query: string, conversationId?: string) =>
  queryOptions({
    queryKey: ['messaging', 'search', teamId, conversationId ?? 'team', query] as const,
    enabled: query.trim().length >= 2,
    queryFn: async (): Promise<MessageSearchResult[]> => {
      const { data, error } = await supabase.rpc('search_messages', { p_team_id: teamId, p_query: query.trim(), p_conversation_id: conversationId })
      if (error) throw toDataError('search messages', error)
      return data
    },
  })

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId)
  if (error) throw toDataError('dismiss the notification', error)
}

export async function markAllNotificationsRead(teamId: string, userId: string) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('team_id', teamId).eq('recipient_id', userId).is('read_at', null)
  if (error) throw toDataError('dismiss the notifications', error)
}

/** Reading a conversation clears its notifications. */
export async function markConversationNotificationsRead(conversationId: string, userId: string) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('recipient_id', userId).is('read_at', null)
  if (error) throw toDataError('dismiss the notifications', error)
}

export async function findExistingGroup(teamId: string, userIds: string[]): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_existing_group', { p_team_id: teamId, p_user_ids: userIds })
  if (error) throw toDataError('check existing groups', error)
  return data
}

export async function createDirectConversation(teamId: string, userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_direct_conversation', { p_team_id: teamId, p_user_id: userId })
  if (error) throw toDataError('start the direct message', error)
  return data
}

export async function createGroupConversation(teamId: string, name: string, userIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_conversation', {
    p_team_id: teamId,
    p_name: name.trim(),
    p_user_ids: userIds,
  })
  if (error) throw toDataError('create the group conversation', error)
  return data
}

export async function addGroupMember(conversationId: string, userId: string, history: 'all' | 'today' | 'after') {
  const { data, error } = await supabase.rpc('add_group_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_history: history,
  })
  if (error) throw toDataError('add the group member', error)
  return data
}

export async function createChannel(teamId: string, name: string, description: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_channel', {
    p_team_id: teamId,
    p_name: name.trim(),
    p_description: description.trim() || undefined,
  })
  if (error) throw toDataError('create the channel', error)
  return data
}

export async function sendMessage(input: {
  conversationId: string
  clientId: string
  content: string
  body?: Json
  parentId?: string | null
  mentionIds?: string[]
}): Promise<Message> {
  const { data, error } = await supabase.rpc('send_message', {
    p_conversation_id: input.conversationId,
    p_client_id: input.clientId,
    p_body: input.body ?? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: input.content }] }] },
    p_content: input.content.trim(),
    p_parent_id: input.parentId ?? undefined,
    p_mention_ids: input.mentionIds ?? [],
  })
  if (error) throw toDataError('send the message', error)
  return data
}

export async function editMessage(messageId: string, content: string, body: Json) {
  const { error } = await supabase.rpc('edit_message', { p_message_id: messageId, p_content: content.trim(), p_body: body })
  if (error) throw toDataError('edit the message', error)
}

export async function deleteMessage(messageId: string) {
  // Remove the files first (best effort); the function then clears the rows and marks the message deleted.
  const { data: files } = await supabase.from('message_attachments').select('storage_path').eq('message_id', messageId)
  if (files && files.length > 0) await supabase.storage.from('message-attachments').remove(files.map((file) => file.storage_path))
  const { error } = await supabase.rpc('delete_message', { p_message_id: messageId })
  if (error) throw toDataError('delete the message', error)
}

export async function toggleReaction(input: { messageId: string; conversationId: string; teamId: string; userId: string; emoji: string; active: boolean }) {
  if (input.active) {
    const { error } = await supabase.from('message_reactions').delete().match({ message_id: input.messageId, user_id: input.userId, emoji: input.emoji })
    if (error) throw toDataError('remove the reaction', error)
  } else {
    const { error } = await supabase.from('message_reactions').insert({ message_id: input.messageId, conversation_id: input.conversationId, team_id: input.teamId, user_id: input.userId, emoji: input.emoji })
    if (error) throw toDataError('add the reaction', error)
  }
}

export async function togglePin(input: { messageId: string; conversationId: string; teamId: string; active: boolean }) {
  if (input.active) {
    const { error } = await supabase.from('message_pins').delete().eq('message_id', input.messageId)
    if (error) throw toDataError('unpin the message', error)
  } else {
    const { error } = await supabase.from('message_pins').insert({ message_id: input.messageId, conversation_id: input.conversationId, team_id: input.teamId })
    if (error) throw toDataError('pin the message', error)
  }
}

export async function markConversationRead(conversationId: string, messageId: string | null) {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId, p_message_id: messageId ?? undefined })
  if (error) throw toDataError('mark the conversation read', error)
}

/** Every attachment in the conversation, in one request; the UI groups them by `message_id`. */
export const conversationAttachmentsQuery = (conversationId: string) =>
  queryOptions({
    queryKey: conversationKeys.attachments(conversationId),
    queryFn: async (): Promise<MessageAttachment[]> => {
      const { data, error } = await supabase.from('message_attachments').select('id, team_id, conversation_id, message_id, uploaded_by, storage_path, file_name, mime_type, file_size, created_at').eq('conversation_id', conversationId).order('created_at')
      if (error) throw toDataError('load attachments', error)
      return data
    },
  })

export async function uploadMessageAttachment(input: { teamId: string; conversationId: string; messageId: string; file: File }): Promise<MessageAttachment> {
  if (input.file.size < 1 || input.file.size > MESSAGE_ATTACHMENT_MAX_BYTES) throw new Error('Attachments must be between 1 byte and 10 MB.')
  if (!(MESSAGE_ATTACHMENT_TYPES as readonly string[]).includes(input.file.type)) throw new Error('That file type is not supported.')
  const extension = input.file.name.includes('.') ? input.file.name.slice(input.file.name.lastIndexOf('.')).toLowerCase() : ''
  const path = `${input.teamId}/${input.conversationId}/${input.messageId}/${crypto.randomUUID()}${extension}`
  const { error: uploadError } = await supabase.storage.from('message-attachments').upload(path, input.file, { contentType: input.file.type, upsert: false })
  if (uploadError) throw toDataError('upload the attachment', { message: uploadError.message })
  const { data, error } = await supabase.from('message_attachments').insert({ team_id: input.teamId, conversation_id: input.conversationId, message_id: input.messageId, storage_path: path, file_name: input.file.name, mime_type: input.file.type, file_size: input.file.size }).select('id, team_id, conversation_id, message_id, uploaded_by, storage_path, file_name, mime_type, file_size, created_at').single()
  if (error) {
    await supabase.storage.from('message-attachments').remove([path])
    throw toDataError('save the attachment', error)
  }
  return data
}

/**
 * Links for every image shown in a conversation, signed in one request (never one per image).
 * Keyed by the paths, so a new image asks again; links last an hour and are reused for 50 minutes.
 */
export const attachmentImageUrlsQuery = (conversationId: string, paths: string[]) =>
  queryOptions({
    queryKey: ['messaging', 'image-urls', conversationId, paths.join('|')] as const,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from('message-attachments').createSignedUrls(paths, 3600)
      if (error) throw toDataError('load images', { message: error.message })
      return Object.fromEntries(data.flatMap((item) => (item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [])))
    },
    staleTime: 50 * 60_000,
  })

export const isImageAttachment = (mimeType: string) => mimeType.startsWith('image/')

export async function createSignedAttachmentUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from('message-attachments').createSignedUrl(storagePath, 300)
  if (error) throw toDataError('open the attachment', { message: error.message })
  return data.signedUrl
}
