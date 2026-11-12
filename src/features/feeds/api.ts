import { requireAffected, toDataError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { ChatEvent, ChatFeed } from './queries'

export { CHAT_EVENTS, chatFeedsQuery, feedKeys, type ChatEvent, type ChatFeed, type ChatFeedKind } from './queries'

/** The database's own messages for bad input are written for people; show them as they are. */
const passMessage = (error: { code?: string; message: string }) => ({ '22023': error.message })

/** Switches on the group's Calsko events or error summaries, in `conversationId` or #activity (made when missing). */
export async function enableChatFeed(teamId: string, kind: 'events' | 'errors', conversationId?: string): Promise<string> {
  const { data, error } = await supabase.rpc('enable_chat_feed', { p_team: teamId, p_kind: kind, p_conversation: conversationId })
  if (error) throw toDataError('switch the feed on', error, passMessage(error))
  return data
}

export async function updateChatFeed(id: string, patch: Partial<{ name: string; enabled: boolean; events: ChatEvent[]; projects: string[]; event_targets: Partial<Record<ChatEvent, string>>; conversation_id: string }>) {
  const { data, error } = await supabase.from('chat_feeds').update(patch).eq('id', id).select('id')
  if (error) throw toDataError('update the feed', error, passMessage(error))
  requireAffected(data, 'update chat feed')
}

export async function deleteChatFeed(feed: Pick<ChatFeed, 'id'>) {
  const { data, error } = await supabase.from('chat_feeds').delete().eq('id', feed.id).select('id')
  if (error) throw toDataError('remove the webhook', error)
  requireAffected(data, 'delete chat feed')
}

/** A new webhook into a channel (#activity when none is given). The token comes back once. */
export async function createChatWebhook(teamId: string, name: string, conversationId?: string): Promise<{ id: string; token: string }> {
  const { data, error } = await supabase.rpc('create_chat_webhook', { p_team: teamId, p_name: name.trim(), p_conversation: conversationId })
  if (error) throw toDataError('add the webhook', error, passMessage(error))
  return data as { id: string; token: string }
}

export async function rotateChatWebhookToken(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_chat_webhook_token', { p_feed: id })
  if (error) throw toDataError('make a new webhook URL', error)
  return data
}

/**
 * Where outside tools post. The token is part of the URL: AWS SNS and Azure action groups can't set
 * headers. Without the token (it's shown once) only the start of the URL is known.
 */
export function chatWebhookUrl(feedId: string, token: string | null): string {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/functions/v1/chat-intake?feed=${feedId}${token ? `&token=${token}` : ''}`
}
